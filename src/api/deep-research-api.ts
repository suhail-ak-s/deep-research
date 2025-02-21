import express, { Request, Response } from 'express';
import { generateObject } from 'ai';
import { o3MiniModel, trimPrompt } from '../ai/providers';
import { systemPrompt } from '../prompt';
import FirecrawlApp, { SearchResponse } from '@mendable/firecrawl-js';
import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables
dotenv.config({path: '.env.local'});

console.log('Starting Deep Research API...');

const app = express();

// Increase JSON body size limit to 10MB
app.use(express.json({ limit: '10mb' }));

// Add request logging middleware
app.use((req: Request, res: Response, next: any) => {
  console.log('Incoming request:', {
    method: req.method,
    path: req.path,
    // Don't log full body for large requests
    bodyLength: req.body ? JSON.stringify(req.body).length : 0,
    query: req.query,
  });
  next();
});

// Initialize Firecrawl
const firecrawl = new FirecrawlApp({
  apiKey: process.env.FIRECRAWL_KEY ?? '',
  apiUrl: process.env.FIRECRAWL_BASE_URL,
});

// Initialize specialized search providers
const academicFirecrawl = new FirecrawlApp({
  apiKey: process.env.ACADEMIC_FIRECRAWL_KEY ?? process.env.FIRECRAWL_KEY ?? '',
  apiUrl: process.env.ACADEMIC_FIRECRAWL_BASE_URL ?? process.env.FIRECRAWL_BASE_URL,
});

const codeFirecrawl = new FirecrawlApp({
  apiKey: process.env.CODE_FIRECRAWL_KEY ?? process.env.FIRECRAWL_KEY ?? '',
  apiUrl: process.env.CODE_FIRECRAWL_BASE_URL ?? process.env.FIRECRAWL_BASE_URL,
});

// Add a test route to verify the server is working
app.get('/test', (req: Request, res: Response) => {
  console.log('Test route hit');
  res.json({ message: 'API is working!' });
});

// Implement generateSerpQueries here since it's internal to the API
async function generateSerpQueries({
  query,
  numQueries = 3,
  learnings,
}: {
  query: string;
  numQueries?: number;
  learnings?: string[];
}) {
  const res = await generateObject({
    model: o3MiniModel,
    system: systemPrompt(),
    prompt: `Given the following prompt from the user, generate a list of SERP queries to research the topic. Return a maximum of ${numQueries} queries, but feel free to return less if the original prompt is clear. Make sure each query is unique and not similar to each other: <prompt>${query}</prompt>\n\n${
      learnings
        ? `Here are some learnings from previous research, use them to generate more specific queries: ${learnings.join(
            '\n',
          )}`
        : ''
    }`,
    schema: z.object({
      queries: z
        .array(
          z.object({
            query: z.string().describe('The SERP query'),
            researchGoal: z
              .string()
              .describe(
                'First talk about the goal of the research that this query is meant to accomplish, then go deeper into how to advance the research once the results are found, mention additional research directions. Be as specific as possible, especially for additional research directions.',
              ),
          }),
        )
        .describe(`List of SERP queries, max of ${numQueries}`),
    }),
  });

  return res.object.queries;
}

// Implement processSerpResult here since it's internal to the API
async function processSerpResult({
  query,
  result,
  numLearnings = 3,
  numFollowUpQuestions = 3,
}: {
  query: string;
  result: SearchResponse;
  numLearnings?: number;
  numFollowUpQuestions?: number;
}) {
  const contents = result.data
    .map(item => item.markdown)
    .filter((content): content is string => content != null)
    .map(content => trimPrompt(content, 25_000));

  const res = await generateObject({
    model: o3MiniModel,
    system: systemPrompt(),
    prompt: `Given the following contents from a SERP search for the query <query>${query}</query>, generate a list of learnings from the contents. Return a maximum of ${numLearnings} learnings, but feel free to return less if the contents are clear. Make sure each learning is unique and not similar to each other. The learnings should be concise and to the point, as detailed and information dense as possible. Make sure to include any entities like people, places, companies, products, things, etc in the learnings, as well as any exact metrics, numbers, or dates. The learnings will be used to research the topic further.\n\n<contents>${contents
      .map(content => `<content>\n${content}\n</content>`)
      .join('\n')}</contents>`,
    schema: z.object({
      learnings: z
        .array(z.string())
        .describe(`List of learnings, max of ${numLearnings}`),
      followUpQuestions: z
        .array(z.string())
        .describe(
          `List of follow-up questions to research the topic further, max of ${numFollowUpQuestions}`,
        ),
    }),
  });

  return res.object;
}

// Specialized query generators
async function generateAcademicQueries(params: {
  query: string;
  numQueries?: number;
  learnings?: string[];
}) {
  const res = await generateObject({
    model: o3MiniModel,
    system: systemPrompt(),
    prompt: `You are an academic research expert. Given the following prompt, generate academic-focused SERP queries to research the topic. Focus on finding academic papers, research studies, and scientific sources. Return a maximum of ${params.numQueries} queries: <prompt>${params.query}</prompt>\n\n${
      params.learnings
        ? `Here are some learnings from previous research, use them to generate more specific academic queries: ${params.learnings.join(
            '\n',
          )}`
        : ''
    }`,
    schema: z.object({
      queries: z
        .array(
          z.object({
            query: z.string().describe('The academic SERP query'),
            researchGoal: z
              .string()
              .describe(
                'First talk about the academic research goal, then suggest specific papers or journals to look for.',
              ),
          }),
        )
        .describe(`List of academic queries, max of ${params.numQueries}`),
    }),
  });

  return res.object.queries;
}

async function generateCodeQueries(params: {
  query: string;
  numQueries?: number;
  learnings?: string[];
}) {
  const res = await generateObject({
    model: o3MiniModel,
    system: systemPrompt(),
    prompt: `You are a software development expert. Given the following prompt, generate code-focused SERP queries to research the topic. Focus on finding documentation, code examples, and technical resources. Return a maximum of ${params.numQueries} queries: <prompt>${params.query}</prompt>\n\n${
      params.learnings
        ? `Here are some learnings from previous research, use them to generate more specific technical queries: ${params.learnings.join(
            '\n',
          )}`
        : ''
    }`,
    schema: z.object({
      queries: z
        .array(
          z.object({
            query: z.string().describe('The code-focused SERP query'),
            researchGoal: z
              .string()
              .describe(
                'First talk about the technical goal, then suggest specific documentation or repositories to look for.',
              ),
          }),
        )
        .describe(`List of code queries, max of ${params.numQueries}`),
    }),
  });

  return res.object.queries;
}

// Specialized result processors
async function processAcademicResults(params: {
  query: string;
  result: SearchResponse;
  numLearnings?: number;
  numFollowUpQuestions?: number;
}) {
  const contents = params.result.data
    .map(item => item.markdown)
    .filter((content): content is string => content != null)
    .map(content => trimPrompt(content, 25_000));

  const res = await generateObject({
    model: o3MiniModel,
    system: systemPrompt(),
    prompt: `You are an academic research expert. Given the following contents from academic sources for the query <query>${params.query}</query>, generate a list of academic findings. Focus on research methodologies, results, and scientific implications. Return a maximum of ${params.numLearnings} findings.\n\n<contents>${contents
      .map(content => `<content>\n${content}\n</content>`)
      .join('\n')}</contents>`,
    schema: z.object({
      learnings: z
        .array(z.string())
        .describe(`List of academic findings, max of ${params.numLearnings}`),
      followUpQuestions: z
        .array(z.string())
        .describe(
          `List of academic follow-up questions, max of ${params.numFollowUpQuestions}`,
        ),
    }),
  });

  return res.object;
}

async function processCodeResults(params: {
  query: string;
  result: SearchResponse;
  numLearnings?: number;
  numFollowUpQuestions?: number;
}) {
  const contents = params.result.data
    .map(item => item.markdown)
    .filter((content): content is string => content != null)
    .map(content => trimPrompt(content, 25_000));

  const res = await generateObject({
    model: o3MiniModel,
    system: systemPrompt(),
    prompt: `You are a software development expert. Given the following contents from technical sources for the query <query>${params.query}</query>, generate a list of technical findings. Focus on implementation details, best practices, and code patterns. Return a maximum of ${params.numLearnings} findings.\n\n<contents>${contents
      .map(content => `<content>\n${content}\n</content>`)
      .join('\n')}</contents>`,
    schema: z.object({
      learnings: z
        .array(z.string())
        .describe(`List of technical findings, max of ${params.numLearnings}`),
      followUpQuestions: z
        .array(z.string())
        .describe(
          `List of technical follow-up questions, max of ${params.numFollowUpQuestions}`,
        ),
    }),
  });

  return res.object;
}

// Register all routes
const router = express.Router();

// Query Generator Endpoint
router.post('/generate-queries', async (req: Request, res: Response) => {
  console.log('Generate queries endpoint hit', req.body);
  try {
    const { query, numQueries, learnings } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }
    console.log('Generating queries for:', { query, numQueries, learnings });
    const queries = await generateSerpQueries({
      query,
      numQueries,
      learnings,
    });
    console.log('Generated queries:', queries);
    res.json(queries);
  } catch (error) {
    console.error('Error generating queries:', error);
    res.status(500).json({ 
      error: 'Failed to generate queries',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// Search Endpoint
router.post('/search', async (req: Request, res: Response) => {
  console.log('Search endpoint hit', req.body);
  try {
    const { query, options } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }
    console.log('Searching for:', { query, options });
    const searchResults = await firecrawl.search(query, {
      timeout: options?.timeout || 15000,
      limit: options?.limit || 5,
      scrapeOptions: options?.scrapeOptions || { formats: ['markdown'] },
    });
    console.log('Search results found:', searchResults.data.length);
    res.json(searchResults);
  } catch (error) {
    console.error('Error searching:', error);
    res.status(500).json({ 
      error: 'Failed to perform search',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

interface SearchResultItem {
  markdown?: string | null;
  url?: string;
  title?: string;
  description?: string;
}

// Result Processor Endpoint
router.post('/process-results', async (req: Request, res: Response) => {
  console.log('Process results endpoint hit');
  try {
    const { query, result, numLearnings, numFollowUpQuestions } = req.body;
    
    // Validate input
    if (!query) {
      console.error('Missing query in request');
      return res.status(400).json({ error: 'Query is required' });
    }
    if (!result) {
      console.error('Missing result in request');
      return res.status(400).json({ error: 'Result is required' });
    }
    if (!result.data || !Array.isArray(result.data)) {
      console.error('Invalid result format:', result);
      return res.status(400).json({ error: 'Result must contain a data array' });
    }

    console.log('Processing results for:', {
      query,
      numResults: result.data.length,
      numLearnings,
      numFollowUpQuestions,
      totalContentLength: result.data.reduce((acc: number, item: SearchResultItem) => 
        acc + (item.markdown?.length || 0), 0)
    });

    // Trim content more aggressively
    const trimmedResult = {
      ...result,
      data: result.data.map((item: SearchResultItem) => ({
        ...item,
        markdown: item.markdown ? trimPrompt(item.markdown, 15_000) : null // Reduced from 25_000 to 15_000
      }))
    };

    // Process the results
    try {
      const processedResults = await processSerpResult({
        query,
        result: trimmedResult,
        numLearnings,
        numFollowUpQuestions,
      });
      
      console.log('Successfully processed results:', {
        numLearnings: processedResults.learnings.length,
        numFollowUpQuestions: processedResults.followUpQuestions.length
      });
      
      res.json(processedResults);
    } catch (processError) {
      console.error('Error in processSerpResult:', processError);
      throw processError;
    }
  } catch (error) {
    console.error('Error processing results:', error);
    res.status(500).json({ 
      error: 'Failed to process results',
      details: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
  }
});

// Register specialized routes
// Academic endpoints
router.post('/generate-queries/academic', async (req: Request, res: Response) => {
  console.log('Academic query generator endpoint hit', req.body);
  try {
    const { query, numQueries, learnings } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }
    const queries = await generateAcademicQueries({
      query,
      numQueries,
      learnings,
    });
    res.json(queries);
  } catch (error) {
    console.error('Error generating academic queries:', error);
    res.status(500).json({ 
      error: 'Failed to generate academic queries',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

router.post('/search/academic', async (req: Request, res: Response) => {
  console.log('Academic search endpoint hit', req.body);
  try {
    const { query, options } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }
    const searchResults = await academicFirecrawl.search(query, {
      timeout: options?.timeout || 15000,
      limit: options?.limit || 5,
      scrapeOptions: options?.scrapeOptions || { formats: ['markdown'] },
    });
    res.json(searchResults);
  } catch (error) {
    console.error('Error in academic search:', error);
    res.status(500).json({ 
      error: 'Failed to perform academic search',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

router.post('/process-results/academic', async (req: Request, res: Response) => {
  console.log('Academic result processor endpoint hit');
  try {
    const { query, result, numLearnings, numFollowUpQuestions } = req.body;
    if (!query || !result || !result.data) {
      return res.status(400).json({ error: 'Invalid request parameters' });
    }
    const processedResults = await processAcademicResults({
      query,
      result,
      numLearnings,
      numFollowUpQuestions,
    });
    res.json(processedResults);
  } catch (error) {
    console.error('Error processing academic results:', error);
    res.status(500).json({ 
      error: 'Failed to process academic results',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// Code endpoints
router.post('/generate-queries/code', async (req: Request, res: Response) => {
  console.log('Code query generator endpoint hit', req.body);
  try {
    const { query, numQueries, learnings } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }
    const queries = await generateCodeQueries({
      query,
      numQueries,
      learnings,
    });
    res.json(queries);
  } catch (error) {
    console.error('Error generating code queries:', error);
    res.status(500).json({ 
      error: 'Failed to generate code queries',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

router.post('/search/code', async (req: Request, res: Response) => {
  console.log('Code search endpoint hit', req.body);
  try {
    const { query, options } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }
    const searchResults = await codeFirecrawl.search(query, {
      timeout: options?.timeout || 15000,
      limit: options?.limit || 5,
      scrapeOptions: options?.scrapeOptions || { formats: ['markdown'] },
    });
    res.json(searchResults);
  } catch (error) {
    console.error('Error in code search:', error);
    res.status(500).json({ 
      error: 'Failed to perform code search',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

router.post('/process-results/code', async (req: Request, res: Response) => {
  console.log('Code result processor endpoint hit');
  try {
    const { query, result, numLearnings, numFollowUpQuestions } = req.body;
    if (!query || !result || !result.data) {
      return res.status(400).json({ error: 'Invalid request parameters' });
    }
    const processedResults = await processCodeResults({
      query,
      result,
      numLearnings,
      numFollowUpQuestions,
    });
    res.json(processedResults);
  } catch (error) {
    console.error('Error processing code results:', error);
    res.status(500).json({ 
      error: 'Failed to process code results',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// Test route
router.get('/test', (req: Request, res: Response) => {
  console.log('Test route hit');
  res.json({ message: 'API is working!' });
});

// Use the router with a prefix
app.use('/api', router);

// Add error handling middleware last
app.use((err: any, req: Request, res: Response, next: any) => {
  console.error('API Error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message,
    details: err.stack,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Deep Research API running on port ${PORT}`);
  console.log('Available routes:');
  console.log('  GET  /api/test');
  console.log('  POST /api/generate-queries');
  console.log('  POST /api/search');
  console.log('  POST /api/process-results');
  console.log('  POST /api/generate-queries/academic');
  console.log('  POST /api/search/academic');
  console.log('  POST /api/process-results/academic');
  console.log('  POST /api/generate-queries/code');
  console.log('  POST /api/search/code');
  console.log('  POST /api/process-results/code');
}); 