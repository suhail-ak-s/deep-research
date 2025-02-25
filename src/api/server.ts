import express from 'express';
import { deepResearch, writeFinalReport, AgentTools, AgentApiConfig, ResearchProgress } from '../deep-research';
import dotenv from 'dotenv';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';

// Load environment variables
dotenv.config({path: '.env.local'});

const app = express();
const port = process.env.PORT || 3000;
console.log('Starting server on port', port);

// Store active research sessions and their abort controllers
const activeResearchSessions = new Map<string, AbortController>();

// Middleware
app.use(express.json());
app.use(cors());

// Add request logging middleware with request ID
app.use((req, res, next) => {
  const requestId = uuidv4();
  res.locals.requestId = requestId;
  
  console.log({
    timestamp: new Date().toISOString(),
    requestId,
    method: req.method,
    path: req.path,
    query: req.query,
    headers: {
      'user-agent': req.headers['user-agent'],
      'accept': req.headers.accept,
      'content-type': req.headers['content-type']
    }
  });

  res.on('finish', () => {
    console.log({
      timestamp: new Date().toISOString(),
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      responseTime: Date.now() - req.socket.bytesRead
    });
  });

  next();
});

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  const requestId = res.locals.requestId;
  console.error({
    timestamp: new Date().toISOString(),
    requestId,
    error: {
      name: err.name,
      message: err.message,
      stack: err.stack
    }
  });

  const errorResponse = {
    message: `# ❌ Server Error

Request ID: ${requestId}
Error: ${err.message}

---
*Please contact support with this Request ID if the issue persists.*`
  };

  if (req.headers.accept?.includes('text/event-stream')) {
    sendSSEMessage(res, 'error', errorResponse);
    res.end();
  } else {
    res.status(500).json(errorResponse);
  }
});

// Helper function to send SSE messages with logging
function sendSSEMessage(res: express.Response, event: string, data: any) {
  try {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    res.write(message);
    
    // Log SSE message sent
    console.log({
      timestamp: new Date().toISOString(),
      requestId: res.locals.requestId,
      event: 'sse_message_sent',
      messageType: event,
      messageLength: message.length
    });
  } catch (error) {
    console.error({
      timestamp: new Date().toISOString(),
      requestId: res.locals.requestId,
      event: 'sse_message_error',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Deep Research endpoint with SSE support
app.post('/api/research', async (req, res) => {
  const requestId = res.locals.requestId;
  
  // Create abort controller for this session
  const controller = new AbortController();
  const signal = controller.signal;
  activeResearchSessions.set(requestId, controller);
  
  // Debug point: Log research request details
  console.debug({
    event: 'debug_research_start',
    requestId,
    query: req.body.query,
    headers: req.headers,
    timestamp: new Date().toISOString()
  });

  // Log research request
  console.log({
    timestamp: new Date().toISOString(),
    requestId,
    event: 'research_request_received',
    query: req.body.query,
    parameters: {
      breadth: req.body.breadth,
      depth: req.body.depth,
      hasCustomTools: !!req.body.agentTools,
      hasApiConfig: !!req.body.agentApiConfig
    }
  });

  // Clean up on client disconnect
  res.on('close', () => {
    // Debug point: Log disconnect details
    console.debug({
      event: 'debug_client_disconnect',
      requestId,
      wasAborted: signal.aborted,
      timestamp: new Date().toISOString()
    });

    console.log({
      timestamp: new Date().toISOString(),
      requestId,
      event: 'client_disconnected'
    });
    if (activeResearchSessions.has(requestId)) {
      const controller = activeResearchSessions.get(requestId);
      controller?.abort('Client disconnected');
      activeResearchSessions.delete(requestId);
    }
  });

  // Check if client accepts SSE
  const wantsSSE = req.headers.accept?.includes('text/event-stream');
  
  if (wantsSSE) {
    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Debug point: Log SSE initialization
    console.debug({
      event: 'debug_sse_init',
      requestId,
      timestamp: new Date().toISOString()
    });
    
    // Send initial connection message with requestId
    sendSSEMessage(res, 'init', { 
      requestId,
      message: `# 🔍 Deep Research Session Started
Request ID: ${requestId}

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

    // Validate required parameters
    if (!query) {
      const error = new Error('Query is required to start research.');
      console.error({
        timestamp: new Date().toISOString(),
        requestId,
        event: 'validation_error',
        error: error.message
      });

      if (wantsSSE) {
        sendSSEMessage(res, 'error', {
          message: `# ❌ Validation Error
Request ID: ${requestId}

${error.message}`
        });
        return res.end();
      }
      return res.status(400).json({ requestId, error: error.message });
    }

    // Validate research parameters
    if (breadth < 1 || breadth > 10) {
      const error = new Error('Breadth must be between 1 and 10');
      console.error({
        timestamp: new Date().toISOString(),
        requestId,
        event: 'validation_error',
        error: error.message,
        value: breadth
      });
      throw error;
    }

    if (depth < 1 || depth > 5) {
      const error = new Error('Depth must be between 1 and 5');
      console.error({
        timestamp: new Date().toISOString(),
        requestId,
        event: 'validation_error',
        error: error.message,
        value: depth
      });
      throw error;
    }

    // Validate agent tools
    if (agentTools) {
      const missingTools = [];
      if (!agentTools.queryGenerator) missingTools.push('Query Generator');
      if (!agentTools.searcher) missingTools.push('Searcher');
      if (!agentTools.resultProcessor) missingTools.push('Result Processor');

      if (missingTools.length > 0) {
        const error = new Error(`Missing required tools: ${missingTools.join(', ')}`);
        console.error({
          timestamp: new Date().toISOString(),
          requestId,
          event: 'validation_error',
          error: error.message,
          missingTools
        });
        throw error;
      }
    }

    // Validate API config
    if (agentApiConfig) {
      const missingEndpoints = [];
      if (!agentApiConfig.queryGeneratorEndpoint) missingEndpoints.push('Query Generator Endpoint');
      if (!agentApiConfig.searchEndpoint) missingEndpoints.push('Search Endpoint');
      if (!agentApiConfig.resultProcessorEndpoint) missingEndpoints.push('Result Processor Endpoint');

      if (missingEndpoints.length > 0) {
        const error = new Error(`Missing required API endpoints: ${missingEndpoints.join(', ')}`);
        console.error({
          timestamp: new Date().toISOString(),
          requestId,
          event: 'validation_error',
          error: error.message,
          missingEndpoints
        });
        throw error;
      }
    }

    let lastProgress: ResearchProgress | null = null;
    const result = await deepResearch({
      query,
      breadth,
      depth,
      agentTools,
      agentApiConfig,
      signal, // Pass abort signal to deepResearch
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

      console.log({
        timestamp: new Date().toISOString(),
        requestId,
        event: 'research_complete',
        stats: {
          totalLearnings: result.learnings.length,
          totalSources: result.visitedUrls.length
        }
      });

      sendSSEMessage(res, 'message', {
        message: `# 📊 Final Research Results

## Key Findings
${learningsMessage}

## Sources Referenced
${urlsMessage}

---`
      });

      console.log({
        timestamp: new Date().toISOString(),
        requestId,
        event: 'report_generation_started'
      });

      sendSSEMessage(res, 'message', { 
        message: `# 📝 Generating Final Report

*Compiling and formatting all research findings...*

---`
      });
    }

    console.log({
      timestamp: new Date().toISOString(),
      requestId,
      event: 'generating_final_report',
      prompt: query
    });

    const report = await writeFinalReport({
      prompt: query,
      learnings: result.learnings,
      visitedUrls: result.visitedUrls,
    });

    console.log({
      timestamp: new Date().toISOString(),
      requestId,
      event: 'report_generated',
      reportLength: report.length
    });

    const finalResponse = {
      message: `# ✅ Research Complete

${report}

---
*End of Research Report*`
    };

    if (wantsSSE) {
      sendSSEMessage(res, 'message', finalResponse);
      console.log({
        timestamp: new Date().toISOString(),
        requestId,
        event: 'sse_research_complete',
        messageType: 'final_report'
      });
      res.end();
    } else {
      console.log({
        timestamp: new Date().toISOString(),
        requestId,
        event: 'research_complete',
        responseType: 'json'
      });
      res.json(finalResponse);
    }
  } catch (error) {
    // Debug point: Log error details
    console.debug({
      event: 'debug_research_error',
      requestId,
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : 'Unknown error',
      timestamp: new Date().toISOString()
    });

    // Remove the abort controller on error
    activeResearchSessions.delete(requestId);

    console.error({
      timestamp: new Date().toISOString(),
      requestId,
      event: 'research_error',
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : 'Unknown error',
      query: req.body.query
    });

    const errorResponse = {
      message: `# ❌ Research Error
Request ID: ${requestId}

${error instanceof Error ? error.message : 'An unknown error occurred'}

---
*Please contact support with this Request ID if the issue persists.*`
    };

    if (wantsSSE) {
      sendSSEMessage(res, 'error', errorResponse);
      res.end();
    } else {
      res.status(500).json({ requestId, ...errorResponse });
    }
  }
});

// Add disconnect endpoint
app.post('/api/research/disconnect/:requestId', (req, res) => {
  const { requestId } = req.params;
  console.log({
    timestamp: new Date().toISOString(),
    event: 'disconnect_request',
    requestId
  });
  
  const controller = activeResearchSessions.get(requestId);
  if (controller) {
    controller.abort('Client requested disconnect');
    activeResearchSessions.delete(requestId);
    res.status(200).json({ 
      status: 'success', 
      message: 'Research session aborted successfully' 
    });
  } else {
    res.status(404).json({ 
      status: 'error', 
      message: 'No active research session found with this ID' 
    });
  }
});

// Start the server
app.listen(port, () => {
  console.log({
    timestamp: new Date().toISOString(),
    event: 'server_start',
    port,
    url: `http://localhost:${port}`
  });
});