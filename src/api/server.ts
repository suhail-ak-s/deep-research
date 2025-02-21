import express from 'express';
import { deepResearch, writeFinalReport, AgentTools, AgentApiConfig, ResearchProgress } from '../deep-research';
import dotenv from 'dotenv';
import cors from 'cors';

// Load environment variables
dotenv.config({path: '.env.local'});

const app = express();
const port = process.env.PORT || 3000;
console.log('Starting server on port', port);

// Middleware
app.use(express.json());
app.use(cors());

// Add request logging middleware
app.use((req, res, next) => {
  next();
});

// Helper function to send SSE messages
function sendSSEMessage(res: express.Response, event: string, data: any) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Deep Research endpoint with SSE support
app.post('/api/research', async (req, res) => {
  // Check if client accepts SSE
  const wantsSSE = req.headers.accept?.includes('text/event-stream');
  
  if (wantsSSE) {
    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Send initial connection message
    sendSSEMessage(res, 'message', { 
      message: `# 🔍 Deep Research Session Started

*Initializing your research journey...*`
    });
  }

  try {
    const { 
      query, 
      breadth = 4, 
      depth = 2,
      agentTools,
      agentApiConfig 
    } = req.body;

    if (!query) {
      if (wantsSSE) {
        sendSSEMessage(res, 'message', {
          message: `# ❌ Error
          
Query is required to start research.`
        });
        return res.end();
      }
      return res.status(400).json({ message: 'Error: Query is required to start research.' });
    }

    // Send research configuration message
    if (wantsSSE) {
      sendSSEMessage(res, 'message', {
        message: `# 📋 Research Configuration

### Main Query
${query}

### Research Parameters
- **Depth:** ${depth} levels of investigation
- **Breadth:** ${breadth} parallel research paths
- **Mode:** ${agentTools ? 'Using Custom Research Tools' : 'Using Standard Research Tools'}

---
*Initiating comprehensive research process...*`
      });
    }

    // Validate agentTools if provided
    if (agentTools && (!agentTools.queryGenerator || !agentTools.searcher || !agentTools.resultProcessor)) {
      if (wantsSSE) {
        sendSSEMessage(res, 'message', {
          message: `# ❌ Configuration Error

Custom tools configuration is incomplete. Required components:
- Query Generator
- Searcher
- Result Processor`
        });
        return res.end();
      }
      return res.status(400).json({ message: 'If agentTools is provided, it must include queryGenerator, searcher, and resultProcessor' });
    }

    // Validate agentApiConfig if provided
    if (agentApiConfig && (!agentApiConfig.queryGeneratorEndpoint || !agentApiConfig.searchEndpoint || !agentApiConfig.resultProcessorEndpoint)) {
      if (wantsSSE) {
        sendSSEMessage(res, 'message', {
          message: `# ❌ API Configuration Error

API configuration is incomplete. Required endpoints:
- Query Generator Endpoint
- Search Endpoint
- Result Processor Endpoint`
        });
        return res.end();
      }
      return res.status(400).json({ message: 'If agentApiConfig is provided, it must include queryGeneratorEndpoint, searchEndpoint, and resultProcessorEndpoint' });
    }

    let lastProgress: ResearchProgress | null = null;
    const result = await deepResearch({
      query,
      breadth,
      depth,
      agentTools,
      agentApiConfig,
      onProgress: (progress) => {
        if (wantsSSE && (!lastProgress || JSON.stringify(progress) !== JSON.stringify(lastProgress))) {
          // Send research depth info
          if (progress.currentDepth !== lastProgress?.currentDepth) {
            sendSSEMessage(res, 'message', {
              message: `# 📊 Research Progress

### Iteration ${progress.totalDepth - progress.currentDepth + 1} of ${progress.totalDepth}
Currently at depth level ${progress.currentDepth} with ${progress.currentDepth} iterations remaining

---`
            });
          }

          // Send generated queries if available and changed
          if (progress.generatedQueries && (!lastProgress?.generatedQueries || 
              JSON.stringify(progress.generatedQueries) !== JSON.stringify(lastProgress.generatedQueries))) {
            const queriesMessage = progress.generatedQueries.map((q, i) => 
              `### 🔍 Query ${i + 1}
**Search Query:**
${q.query}

**Research Goal:**
${q.researchGoal}`
            ).join('\n\n---\n\n');

            sendSSEMessage(res, 'message', {
              message: `# 🎯 Generated Research Queries

${queriesMessage}

---`
            });
          }

          // Send current query if changed
          if (progress.currentQuery && progress.currentQuery !== lastProgress?.currentQuery) {
            sendSSEMessage(res, 'message', {
              message: `# 🔄 Research In Progress

### Currently Investigating
${progress.currentQuery}

### Progress
✓ ${progress.completedQueries} of ${progress.totalQueries} queries completed

---`
            });
          }

          lastProgress = {...progress};
        }
      },
      onSearchStart: (searcher, query) => {
        if (wantsSSE) {
          sendSSEMessage(res, 'message', {
            message: `# 🔍 Search Phase

### Using Research Tool
**${searcher.metadata.name}**
*Capabilities: ${searcher.metadata.capabilities.join(', ')}*

### Current Query
${query}

---`
          });
        }
      },
      onProcessStart: (processor, query) => {
        if (wantsSSE) {
          sendSSEMessage(res, 'message', {
            message: `# 🔄 Processing Phase

### Using Processor
**${processor.metadata.name}**
*Capabilities: ${processor.metadata.capabilities.join(', ')}*

### Processing Query
${query}

---`
          });
        }
      },
      onProcessComplete: (results) => {
        if (wantsSSE && results.learnings?.length > 0) {
          const learningsMessage = results.learnings.map((learning, i) => `${i + 1}. ${learning}`).join('\n');
          const questionsMessage = results.followUpQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n');

          sendSSEMessage(res, 'message', {
            message: `# 📝 New Research Findings

### Key Learnings
${learningsMessage}

### Follow-up Questions
${questionsMessage}

---`
          });
        }
      }
    });

    // Generate the final report
    if (wantsSSE) {
      const learningsMessage = result.learnings.map((learning, i) => `${i + 1}. ${learning}`).join('\n');
      const urlsMessage = result.visitedUrls.map((url, i) => `${i + 1}. [Source](${url})`).join('\n');

      sendSSEMessage(res, 'message', {
        message: `# 📊 Final Research Results

## Key Findings
${learningsMessage}

## Sources Referenced
${urlsMessage}

---`
      });

      sendSSEMessage(res, 'message', { 
        message: `# 📝 Generating Final Report

*Compiling and formatting all research findings...*

---`
      });
    }

    const report = await writeFinalReport({
      prompt: query,
      learnings: result.learnings,
      visitedUrls: result.visitedUrls,
    });

    const finalResponse = {
      message: `# ✅ Research Complete

${report}

---
*End of Research Report*`
    };

    if (wantsSSE) {
      sendSSEMessage(res, 'message', finalResponse);
      res.end();
    } else {
      res.json(finalResponse);
    }
  } catch (error) {
    console.error('Error during research:', error);
    const errorResponse = {
      message: `# ❌ Research Error

${error instanceof Error ? error.message : 'An unknown error occurred'}

---
*Please try again or contact support if the issue persists.*`
    };

    if (wantsSSE) {
      sendSSEMessage(res, 'message', errorResponse);
      res.end();
    } else {
      res.status(500).json(errorResponse);
    }
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Deep Research API server running at http://localhost:${port}`);
}); 