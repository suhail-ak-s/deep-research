import express, { Request, Response } from 'express';
import { generateObject } from 'ai';
import { o3MiniModel } from '../ai/providers';
import { systemPrompt } from '../prompt';
import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables
dotenv.config();

// Note: In a real implementation, you would use the actual YouTube API
// This is a simplified mock for demonstration
class YouTubeAPI {
  async search(query: string, options: { maxResults?: number } = {}) {
    // Simulate YouTube search
    return {
      data: [
        {
          id: 'video1',
          title: `Result for: ${query}`,
          description: 'Sample video description',
          url: `https://youtube.com/watch?v=video1`,
          transcript: 'Sample video transcript...',
          statistics: {
            views: 10000,
            likes: 1000,
            comments: 100
          }
        }
        // In reality, this would return actual YouTube search results
      ]
    };
  }
}

const youtube = new YouTubeAPI();

const app = express();
app.use(express.json({ limit: '10mb' }));

// Add request logging middleware
app.use((req: Request, res: Response, next: any) => {
  console.log('Incoming request:', {
    method: req.method,
    path: req.path,
    bodyLength: req.body ? JSON.stringify(req.body).length : 0,
  });
  next();
});

// Register routes
const router = express.Router();

// Query Generator for YouTube-specific queries
router.post('/generate-queries', async (req: Request, res: Response) => {
  try {
    const { query, numQueries = 3 } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    const result = await generateObject({
      model: o3MiniModel,
      system: systemPrompt(),
      prompt: `You are a YouTube research expert. Given the following topic, generate ${numQueries} YouTube search queries that will help find the most relevant and high-quality videos. Focus on educational content, tutorials, expert interviews, and authoritative channels: <topic>${query}</topic>`,
      schema: z.object({
        queries: z.array(z.object({
          query: z.string().describe('The YouTube search query'),
          researchGoal: z.string().describe('What specific information or perspective this query aims to find'),
        }))
      }),
    });

    res.json(result.object.queries);
  } catch (error) {
    console.error('Error generating YouTube queries:', error);
    res.status(500).json({ error: 'Failed to generate queries' });
  }
});

// YouTube Search Endpoint
router.post('/search', async (req: Request, res: Response) => {
  try {
    const { query, options } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    const searchResults = await youtube.search(query, {
      maxResults: options?.limit || 5
    });

    res.json(searchResults);
  } catch (error) {
    console.error('Error searching YouTube:', error);
    res.status(500).json({ error: 'Failed to search YouTube' });
  }
});

// Process YouTube Results
router.post('/process-results', async (req: Request, res: Response) => {
  try {
    const { query, result, numLearnings = 3 } = req.body;
    if (!query || !result?.data) {
      return res.status(400).json({ error: 'Query and results are required' });
    }

    const processedResults = await generateObject({
      model: o3MiniModel,
      system: systemPrompt(),
      prompt: `You are analyzing YouTube video content. Given the following videos about "${query}", extract the key learnings and suggest follow-up topics to explore. Focus on factual information, expert insights, and practical knowledge.

Videos:
${result.data.map((video: any) => `
Title: ${video.title}
Description: ${video.description}
Transcript Excerpt: ${video.transcript}
Stats: ${video.statistics.views} views, ${video.statistics.likes} likes
`).join('\n')}`,
      schema: z.object({
        learnings: z.array(z.string()),
        followUpQuestions: z.array(z.string()),
      }),
    });

    res.json(processedResults.object);
  } catch (error) {
    console.error('Error processing YouTube results:', error);
    res.status(500).json({ error: 'Failed to process results' });
  }
});

// Test route
router.get('/test', (req: Request, res: Response) => {
  res.json({ message: 'YouTube Research API is working!' });
});

app.use('/api', router);

const PORT = process.env.YOUTUBE_API_PORT || 3001;
app.listen(PORT, () => {
  console.log(`YouTube Research API running on port ${PORT}`);
  console.log('Available routes:');
  console.log('  GET  /api/test');
  console.log('  POST /api/generate-queries');
  console.log('  POST /api/search');
  console.log('  POST /api/process-results');
}); 