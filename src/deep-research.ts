import FirecrawlApp, { SearchResponse } from '@mendable/firecrawl-js';
import { generateObject } from 'ai';
import { compact } from 'lodash-es';
import pLimit from 'p-limit';
import { z } from 'zod';

import { o3MiniModel, trimPrompt } from './ai/providers';
import { systemPrompt } from './prompt';
import { OutputManager } from './output-manager';

import dotenv from 'dotenv';

// Load environment variables
dotenv.config({path: '.env.local'});

// Initialize output manager for coordinated console/progress output
const output = new OutputManager();

// Replace console.log with output.log
function log(...args: any[]) {
  output.log(...args);
}

export interface ResearchProgress {
  // Original progress tracking fields
  currentDepth: number;
  totalDepth: number;
  currentBreadth: number;
  totalBreadth: number;
  currentQuery?: string;
  totalQueries: number;
  completedQueries: number;

  // New fields for detailed progress
  currentPhase?: string;
  generatedQueries?: Array<{
    query: string;
    researchGoal?: string;
  }>;
  learnings?: string[];
  status?: string;
}

export interface ResearchResult {
  learnings: string[];
  visitedUrls: string[];
  phases?: string[];
}

export type SearchCallbacks = {
  onProgress?: (progress: ResearchProgress) => void;
  onSearchStart?: (searcher: Searcher, query: string) => void;
  onSearchComplete?: (response: SearchResponse) => void;
  onProcessStart?: (processor: ResultProcessor, query: string) => void;
  onProcessComplete?: (results: { learnings: string[]; followUpQuestions: string[] }) => void;
};

// increase this if you have higher API rate limits
const ConcurrencyLimit = 2;

// Initialize Firecrawl with optional API key and optional base url

const firecrawl = new FirecrawlApp({
  apiKey: process.env.FIRECRAWL_KEY ?? '',
  apiUrl: process.env.FIRECRAWL_BASE_URL,
});

console.log('Firecrawl initialized', process.env.FIRECRAWL_KEY, process.env.FIRECRAWL_BASE_URL);

// take en user query, return a list of SERP queries
async function generateSerpQueries({
  query,
  numQueries = 3,
  learnings,
}: {
  query: string;
  numQueries?: number;

  // optional, if provided, the research will continue from the last learning
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
  log(
    `Created ${res.object.queries.length} queries`,
    res.object.queries,
  );

  return res.object.queries.slice(0, numQueries);
}

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
  const contents = compact(result.data.map(item => item.markdown)).map(
    content => trimPrompt(content, 25_000),
  );
  log(`Ran ${query}, found ${contents.length} contents`);

  const res = await generateObject({
    model: o3MiniModel,
    abortSignal: AbortSignal.timeout(60_000),
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
  log(
    `Created ${res.object.learnings.length} learnings`,
    res.object.learnings,
  );

  return res.object;
}

export async function writeFinalReport({
  prompt,
  learnings,
  visitedUrls,
}: {
  prompt: string;
  learnings: string[];
  visitedUrls: string[];
}) {
  const learningsString = trimPrompt(
    learnings
      .map(learning => `<learning>\n${learning}\n</learning>`)
      .join('\n'),
    150_000,
  );

  const res = await generateObject({
    model: o3MiniModel,
    system: systemPrompt(),
    prompt: `Given the following prompt from the user, write a final report on the topic using the learnings from research. Make it as as detailed as possible, aim for 3 or more pages, include ALL the learnings from research:\n\n<prompt>${prompt}</prompt>\n\nHere are all the learnings from previous research:\n\n<learnings>\n${learningsString}\n</learnings>`,
    schema: z.object({
      reportMarkdown: z
        .string()
        .describe('Final report on the topic in Markdown'),
    }),
  });

  // Append the visited URLs section to the report
  const urlsSection = `\n\n## Sources\n\n${visitedUrls.map(url => `- ${url}`).join('\n')}`;
  return res.object.reportMarkdown + urlsSection;
}

// API Configuration interfaces
export interface ApiEndpoint {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  apiKey?: string;
}

export interface AgentApiConfig {
  queryGeneratorEndpoint: ApiEndpoint;
  searchEndpoint: ApiEndpoint;
  resultProcessorEndpoint: ApiEndpoint;
  systemPrompt?: string;
}

// Add metadata for tools to help with selection
export interface ToolMetadata {
  name: string;
  description: string;
  capabilities: string[];
  preferredQueries?: string[];  // regex patterns for queries this tool handles well
  maxQueryLength?: number;      // maximum query length this tool can handle
  costPerQuery?: number;        // relative cost per query (for optimization)
}

// Enhance the base interfaces with metadata
export interface QueryGenerator {
  metadata: ToolMetadata;
  generateQueries: (params: {
    query: string;
    numQueries?: number;
    learnings?: string[];
  }) => Promise<Array<{
    query: string;
    researchGoal: string;
  }>>;
}

export interface Searcher {
  metadata: ToolMetadata;
  search: (query: string, options?: any) => Promise<SearchResponse>;
}

export interface ResultProcessor {
  metadata: ToolMetadata;
  processResults: (params: {
    query: string;
    result: SearchResponse;
    numLearnings?: number;
    numFollowUpQuestions?: number;
  }) => Promise<{
    learnings: string[];
    followUpQuestions: string[];
  }>;
}

// Modify AgentTools to support multiple tools
export interface AgentTools {
  queryGenerators: QueryGenerator[];
  searchers: Searcher[];
  resultProcessors: ResultProcessor[];
  systemPrompt?: string;
}

// Add interfaces for scoring results
interface ScoredQueryGenerator {
  generator: QueryGenerator;
  score: number;
}

interface ScoredSearcher {
  searcher: Searcher;
  score: number;
}

interface ScoredProcessor {
  processor: ResultProcessor;
  score: number;
}

// Tool selection functions
function selectQueryGenerator(generators: QueryGenerator[], query: string): QueryGenerator {
  if (generators.length === 0) {
    throw new Error('No query generators available');
  }
  
  const firstGenerator = generators[0];
  if (!firstGenerator) {
    throw new Error('No query generators available');
  }

  // Default to the first generator if only one exists
  if (generators.length === 1) return firstGenerator;

  // Score each generator based on capabilities and query
  const scores = generators.map(gen => {
    let score = 0;
    
    // Check if query matches preferred patterns
    if (gen.metadata.preferredQueries) {
      for (const pattern of gen.metadata.preferredQueries) {
        if (new RegExp(pattern, 'i').test(query)) score += 2;
      }
    }
    
    // Check query length constraints
    if (gen.metadata.maxQueryLength && query.length <= gen.metadata.maxQueryLength) {
      score += 1;
    }
    
    return { generator: gen, score } as ScoredQueryGenerator;
  });

  // Return the generator with the highest score, with type safety
  const initialValue: ScoredQueryGenerator = { generator: firstGenerator, score: -1 };
  return scores.reduce((best, current) => 
    current.score > best.score ? current : best, initialValue
  ).generator;
}

function selectSearcher(searchers: Searcher[], query: string): Searcher {
  if (searchers.length === 0) {
    throw new Error('No searchers available');
  }

  const firstSearcher = searchers[0];
  if (!firstSearcher) {
    throw new Error('No searchers available');
  }

  if (searchers.length === 1) return firstSearcher;

  const scores = searchers.map(searcher => {
    let score = 0;
    
    // Check capabilities
    if (searcher.metadata.capabilities.includes('web_search')) score += 1;
    if (searcher.metadata.capabilities.includes('academic_search') && /\b(research|study|paper)\b/i.test(query)) score += 2;
    if (searcher.metadata.capabilities.includes('code_search') && /\b(code|programming|software)\b/i.test(query)) score += 2;
    
    // Check preferred queries
    if (searcher.metadata.preferredQueries) {
      for (const pattern of searcher.metadata.preferredQueries) {
        if (new RegExp(pattern, 'i').test(query)) score += 2;
      }
    }
    
    return { searcher, score } as ScoredSearcher;
  });

  // Return the searcher with the highest score, with type safety
  const initialValue: ScoredSearcher = { searcher: firstSearcher, score: -1 };
  return scores.reduce((best, current) => 
    current.score > best.score ? current : best, initialValue
  ).searcher;
}

function selectResultProcessor(processors: ResultProcessor[], query: string, result: SearchResponse): ResultProcessor {
  if (processors.length === 0) {
    throw new Error('No result processors available');
  }

  const firstProcessor = processors[0];
  if (!firstProcessor) {
    throw new Error('No result processors available');
  }

  if (processors.length === 1) return firstProcessor;

  const scores = processors.map(processor => {
    let score = 0;
    
    // Check if processor is optimized for the content type
    const hasCode = result.data.some(item => /```|\bfunction\b|\bclass\b/i.test(item.markdown || ''));
    const hasAcademic = result.data.some(item => /doi|arxiv|journal|paper/i.test(item.markdown || ''));
    
    if (hasCode && processor.metadata.capabilities.includes('code_analysis')) score += 2;
    if (hasAcademic && processor.metadata.capabilities.includes('academic_analysis')) score += 2;
    
    // Consider cost for optimization
    if (processor.metadata.costPerQuery) {
      score -= processor.metadata.costPerQuery / 10; // Normalize cost impact
    }
    
    return { processor, score } as ScoredProcessor;
  });

  // Return the processor with the highest score, with type safety
  const initialValue: ScoredProcessor = { processor: firstProcessor, score: -1 };
  return scores.reduce((best, current) => 
    current.score > best.score ? current : best, initialValue
  ).processor;
}

// Add type definitions for API parameters
interface QueryGeneratorParams {
  query: string;
  numQueries?: number;
  learnings?: string[];
}

interface SearchParams {
  query: string;
  options?: {
    timeout?: number;
    limit?: number;
    scrapeOptions?: {
      formats?: string[];
    };
  };
}

interface ResultProcessorParams {
  query: string;
  result: SearchResponse;
  numLearnings?: number;
  numFollowUpQuestions?: number;
}

// Modify createApiBasedTools to support multiple tools
async function createApiBasedTools(apiConfig: AgentApiConfig): Promise<AgentTools> {
  // Create default API-based tools
  const defaultTools = {
    queryGenerators: [{
      metadata: {
        name: 'Default Query Generator',
        description: 'General purpose query generator',
        capabilities: ['general_queries'],
      },
      generateQueries: async (params: QueryGeneratorParams) => {
        const response = await fetch(apiConfig.queryGeneratorEndpoint.url, {
          method: apiConfig.queryGeneratorEndpoint.method || 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiConfig.queryGeneratorEndpoint.apiKey && {
              'Authorization': `Bearer ${apiConfig.queryGeneratorEndpoint.apiKey}`
            }),
            ...apiConfig.queryGeneratorEndpoint.headers,
          },
          body: JSON.stringify(params),
        });

        if (!response.ok) {
          throw new Error(`Query generator API error: ${response.statusText}`);
        }

        return response.json();
      }
    }],
    searchers: [{
      metadata: {
        name: 'Default Searcher',
        description: 'General purpose web searcher',
        capabilities: ['web_search'],
      },
      search: async (query: string, options?: SearchParams['options']) => {
        const response = await fetch(apiConfig.searchEndpoint.url, {
          method: apiConfig.searchEndpoint.method || 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiConfig.searchEndpoint.apiKey && {
              'Authorization': `Bearer ${apiConfig.searchEndpoint.apiKey}`
            }),
            ...apiConfig.searchEndpoint.headers,
          },
          body: JSON.stringify({ query, options }),
        });

        if (!response.ok) {
          throw new Error(`Search API error: ${response.statusText}`);
        }

        return response.json();
      }
    }],
    resultProcessors: [{
      metadata: {
        name: 'Default Result Processor',
        description: 'General purpose result processor',
        capabilities: ['general_processing'],
      },
      processResults: async (params: ResultProcessorParams) => {
        const response = await fetch(apiConfig.resultProcessorEndpoint.url, {
          method: apiConfig.resultProcessorEndpoint.method || 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiConfig.resultProcessorEndpoint.apiKey && {
              'Authorization': `Bearer ${apiConfig.resultProcessorEndpoint.apiKey}`
            }),
            ...apiConfig.resultProcessorEndpoint.headers,
          },
          body: JSON.stringify(params),
        });

        if (!response.ok) {
          throw new Error(`Result processor API error: ${response.statusText}`);
        }

        return response.json();
      }
    }],
    systemPrompt: apiConfig.systemPrompt,
  };

  return defaultTools;
}

// Update defaultAgentTools to match new interface
export const defaultAgentTools: AgentTools = {
  queryGenerators: [{
    metadata: {
      name: 'Default SERP Query Generator',
      description: 'Generates SERP queries for web research',
      capabilities: ['web_search'],
    },
    generateQueries: generateSerpQueries,
  }],
  searchers: [{
    metadata: {
      name: 'Firecrawl Searcher',
      description: 'Web search using Firecrawl',
      capabilities: ['web_search'],
    },
    search: firecrawl.search.bind(firecrawl),
  }],
  resultProcessors: [{
    metadata: {
      name: 'Default Result Processor',
      description: 'Processes web search results',
      capabilities: ['general_processing'],
    },
    processResults: processSerpResult,
  }],
};

// Update deepResearch function to use tool selection
export async function deepResearch({
  query,
  breadth,
  depth,
  learnings = [],
  visitedUrls = [],
  onProgress,
  onSearchStart,
  onSearchComplete,
  onProcessStart,
  onProcessComplete,
  agentTools = defaultAgentTools,
  agentApiConfig,
}: {
  query: string;
  breadth: number;
  depth: number;
  learnings?: string[];
  visitedUrls?: string[];
  agentTools?: AgentTools;
  agentApiConfig?: AgentApiConfig;
} & SearchCallbacks): Promise<ResearchResult> {
  const tools = agentApiConfig ? await createApiBasedTools(agentApiConfig) : agentTools;

  const progress: ResearchProgress = {
    currentDepth: depth,
    totalDepth: depth,
    currentBreadth: breadth,
    totalBreadth: breadth,
    totalQueries: 0,
    completedQueries: 0,
  };
  
  const reportProgress = (update: Partial<ResearchProgress>) => {
    Object.assign(progress, update);
    onProgress?.(progress);
  };

  // Select and use appropriate query generator
  const selectedGenerator = selectQueryGenerator(tools.queryGenerators, query);
  log(`Selected query generator: ${selectedGenerator.metadata.name}`);
  
  const serpQueries = await selectedGenerator.generateQueries({
    query,
    learnings,
    numQueries: breadth,
  });
  
  reportProgress({
    totalQueries: serpQueries.length,
    currentQuery: serpQueries[0]?.query
  });
  
  const limit = pLimit(ConcurrencyLimit);

  const results = await Promise.all(
    serpQueries.map(serpQuery =>
      limit(async () => {
        try {
          // Select and use appropriate searcher
          const selectedSearcher = selectSearcher(tools.searchers, serpQuery.query);
          onSearchStart?.(selectedSearcher, serpQuery.query);
          
          const result = await selectedSearcher.search(serpQuery.query, {
            timeout: 15000,
            limit: 5,
            scrapeOptions: { formats: ['markdown'] },
          });
          onSearchComplete?.(result);

          // Collect URLs from this search
          const newUrls = compact(result.data.map(item => item.url));
          const newBreadth = Math.ceil(breadth / 2);
          const newDepth = depth - 1;

          // Select and use appropriate result processor
          const selectedProcessor = selectResultProcessor(tools.resultProcessors, serpQuery.query, result);
          onProcessStart?.(selectedProcessor, serpQuery.query);
          
          const newLearnings = await selectedProcessor.processResults({
            query: serpQuery.query,
            result,
            numFollowUpQuestions: newBreadth,
          });
          onProcessComplete?.(newLearnings);
          
          const allLearnings = [...learnings, ...newLearnings.learnings];
          const allUrls = [...visitedUrls, ...newUrls];

          if (newDepth > 0) {
            log(
              `Researching deeper, breadth: ${newBreadth}, depth: ${newDepth}`,
            );

            reportProgress({
              currentDepth: newDepth,
              currentBreadth: newBreadth,
              completedQueries: progress.completedQueries + 1,
              currentQuery: serpQuery.query,
            });

            const nextQuery = `
            Previous research goal: ${serpQuery.researchGoal}
            Follow-up research directions: ${newLearnings.followUpQuestions.map(q => `\n${q}`).join('')}
          `.trim();

            return deepResearch({
              query: nextQuery,
              breadth: newBreadth,
              depth: newDepth,
              learnings: allLearnings,
              visitedUrls: allUrls,
              onProgress,
              onSearchStart,
              onSearchComplete,
              onProcessStart,
              onProcessComplete,
              agentTools: tools,
              agentApiConfig,
            });
          } else {
            reportProgress({
              currentDepth: 0,
              completedQueries: progress.completedQueries + 1,
              currentQuery: serpQuery.query,
            });
            return {
              learnings: allLearnings,
              visitedUrls: allUrls,
            };
          }
        } catch (e: any) {
          if (e.message && e.message.includes('Timeout')) {
            log(
              `Timeout error running query: ${serpQuery.query}: `,
              e,
            );
          } else {
            log(`Error running query: ${serpQuery.query}: `, e);
          }
          return {
            learnings: [],
            visitedUrls: [],
          };
        }
      }),
    ),
  );

  return {
    learnings: [...new Set(results.flatMap(r => r.learnings))],
    visitedUrls: [...new Set(results.flatMap(r => r.visitedUrls))],
  };
}
