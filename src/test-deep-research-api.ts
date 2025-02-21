import { deepResearch, AgentApiConfig, writeFinalReport, AgentTools } from './deep-research';
import * as fs from 'fs/promises';

const BASE_URL = 'http://localhost:3000';

async function testDeepResearch(useApi: boolean = false) {
  let apiConfig: AgentApiConfig | undefined;

  if (useApi) {
    // First test if the API is running
    try {
      const testResponse = await fetch(`${BASE_URL}/api/test`);
      if (!testResponse.ok) {
        throw new Error('API server is not responding');
      }
      console.log('API server is running:', await testResponse.json());

      // Test the generate-queries endpoint directly
      const queryResponse = await fetch(`${BASE_URL}/api/generate-queries`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: "Test query about quantum computing",
          numQueries: 1
        })
      });
      
      if (!queryResponse.ok) {
        throw new Error(`Query generator test failed: ${await queryResponse.text()}`);
      }
      console.log('Query generator test successful');

      // Set up specialized API configs for different types of research
      const academicApiConfig: AgentApiConfig = {
        queryGeneratorEndpoint: {
          url: `${BASE_URL}/api/generate-queries/academic`,
          method: 'POST',
        },
        searchEndpoint: {
          url: `${BASE_URL}/api/search/academic`,
          method: 'POST',
        },
        resultProcessorEndpoint: {
          url: `${BASE_URL}/api/process-results/academic`,
          method: 'POST',
        },
        systemPrompt: "You are a research agent specialized in academic research...",
      };

      const codeApiConfig: AgentApiConfig = {
        queryGeneratorEndpoint: {
          url: `${BASE_URL}/api/generate-queries/code`,
          method: 'POST',
        },
        searchEndpoint: {
          url: `${BASE_URL}/api/search/code`,
          method: 'POST',
        },
        resultProcessorEndpoint: {
          url: `${BASE_URL}/api/process-results/code`,
          method: 'POST',
        },
        systemPrompt: "You are a research agent specialized in code and software development...",
      };

      const generalApiConfig: AgentApiConfig = {
        queryGeneratorEndpoint: {
          url: `${BASE_URL}/api/generate-queries`,
          method: 'POST',
        },
        searchEndpoint: {
          url: `${BASE_URL}/api/search`,
          method: 'POST',
        },
        resultProcessorEndpoint: {
          url: `${BASE_URL}/api/process-results`,
          method: 'POST',
        },
        systemPrompt: "You are a research agent specialized in general web research...",
      };

      apiConfig = generalApiConfig; // Default to general config
      
    } catch (error) {
      console.error('Failed to connect to API server or test endpoints:', error);
      return;
    }
  }

  try {
    // Test different types of queries
    const queries = [
    //   {
    //     name: 'Academic Query',
    //     query: "What are the latest developments in quantum computing research papers?",
    //   },
    //   {
    //     name: 'Code Query',
    //     query: "How to implement GraphQL authentication in Node.js?",
    //   },
      {
        name: 'General Query',
        query: `i want you to fiest find me list of all hill stations in india. Then ckeck where is the weather shich is good and above 20 deg cel. Also check weather about if its going to rain in next 1 week. Then check if there are enough tourist going in thsi time of the year and then find me train ticketrs and flioght tickets from chennai in next 2 weeks which is cheaper than USD200.

go with deep research mode and give me the best result`,
      },
    ];

    let combinedTools: AgentTools | undefined;
    if (useApi) {
      combinedTools = {
        queryGenerators: [
          {
            metadata: {
              name: 'Academic Query Generator',
              description: 'Specialized in academic research queries',
              capabilities: ['academic_search'],
              preferredQueries: ['research', 'study', 'paper', 'journal', 'science'],
            },
            generateQueries: async (params) => {
              const response = await fetch(`${BASE_URL}/api/generate-queries/academic`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params),
              });
              if (!response.ok) throw new Error('Academic query generation failed');
              return response.json();
            },
          },
          {
            metadata: {
              name: 'Code Query Generator',
              description: 'Specialized in programming and software development queries',
              capabilities: ['code_search'],
              preferredQueries: ['code', 'programming', 'software', 'development', 'github'],
            },
            generateQueries: async (params) => {
              const response = await fetch(`${BASE_URL}/api/generate-queries/code`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params),
              });
              if (!response.ok) throw new Error('Code query generation failed');
              return response.json();
            },
          },
          {
            metadata: {
              name: 'General Query Generator',
              description: 'General purpose web research queries',
              capabilities: ['web_search'],
              preferredQueries: ['what', 'how', 'why', 'when', 'where'],
            },
            generateQueries: async (params) => {
              const response = await fetch(`${BASE_URL}/api/generate-queries`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params),
              });
              if (!response.ok) throw new Error('General query generation failed');
              return response.json();
            },
          },
        ],
        searchers: [
          {
            metadata: {
              name: 'Academic Searcher',
              description: 'Searches academic sources and research papers',
              capabilities: ['academic_search'],
              preferredQueries: ['research', 'study', 'paper', 'journal', 'science'],
            },
            search: async (query, options) => {
              const response = await fetch(`${BASE_URL}/api/search/academic`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query, options }),
              });
              if (!response.ok) throw new Error('Academic search failed');
              return response.json();
            },
          },
          {
            metadata: {
              name: 'Code Searcher',
              description: 'Searches code repositories and documentation',
              capabilities: ['code_search'],
              preferredQueries: ['code', 'programming', 'software', 'development', 'github'],
            },
            search: async (query, options) => {
              const response = await fetch(`${BASE_URL}/api/search/code`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query, options }),
              });
              if (!response.ok) throw new Error('Code search failed');
              return response.json();
            },
          },
          {
            metadata: {
              name: 'General Web Searcher',
              description: 'General purpose web search',
              capabilities: ['web_search'],
            },
            search: async (query, options) => {
              const response = await fetch(`${BASE_URL}/api/search`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query, options }),
              });
              if (!response.ok) throw new Error('General search failed');
              return response.json();
            },
          },
        ],
        resultProcessors: [
          {
            metadata: {
              name: 'Academic Result Processor',
              description: 'Processes academic research results',
              capabilities: ['academic_analysis'],
              costPerQuery: 2.0, // Higher cost due to specialized processing
            },
            processResults: async (params) => {
              const response = await fetch(`${BASE_URL}/api/process-results/academic`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params),
              });
              if (!response.ok) throw new Error('Academic result processing failed');
              return response.json();
            },
          },
          {
            metadata: {
              name: 'Code Result Processor',
              description: 'Processes code and technical documentation',
              capabilities: ['code_analysis'],
              costPerQuery: 1.5,
            },
            processResults: async (params) => {
              const response = await fetch(`${BASE_URL}/api/process-results/code`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params),
              });
              if (!response.ok) throw new Error('Code result processing failed');
              return response.json();
            },
          },
          {
            metadata: {
              name: 'General Result Processor',
              description: 'General purpose result processor',
              capabilities: ['general_processing'],
              costPerQuery: 1.0,
            },
            processResults: async (params) => {
              const response = await fetch(`${BASE_URL}/api/process-results`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params),
              });
              if (!response.ok) throw new Error('General result processing failed');
              return response.json();
            },
          },
        ],
      };
    }

    for (const { name, query } of queries) {
      console.log(`\n=== Testing ${name} ===`);
      console.log(`Starting deep research using ${useApi ? 'API' : 'default'} implementation...`);
      
      const result = await deepResearch({
        query,
        breadth: 5,
        depth: 5,
        agentTools: combinedTools,
        agentApiConfig: apiConfig,
        onProgress: (progress) => {
          console.log('Research Progress:', JSON.stringify(progress, null, 2));
        },
      });

      console.log('Research completed!');
      console.log('Total learnings:', result.learnings.length);
      console.log('Sample learnings:', result.learnings.slice(0, 3));
      console.log('Total URLs visited:', result.visitedUrls.length);

      // Generate and save the final report
      console.log('\nGenerating final report...');
      const report = await writeFinalReport({
        prompt: query,
        learnings: result.learnings,
        visitedUrls: result.visitedUrls,
      });

      // Save report to a test-specific file
      const outputFile = `test-output-${name.toLowerCase().replace(' ', '-')}-${useApi ? 'api' : 'default'}.md`;
      await fs.writeFile(outputFile, report, 'utf-8');

      console.log(`\nFinal Report has been saved to ${outputFile}`);
      console.log('\nReport Preview:');
      console.log('----------------------------------------');
      console.log(report.slice(0, 500) + '...'); // Show first 500 characters
      console.log('----------------------------------------');
    }

  } catch (error) {
    console.error('Error during research:', error);
    if (error instanceof Error) {
      console.error('Error stack:', error.stack);
    }
  }
}

// Run both tests
async function runTests() {
  console.log('\n=== Testing with default implementation ===\n');
  await testDeepResearch(false);
  
  console.log('\n=== Testing with API implementation ===\n');
  await testDeepResearch(true);
}

// Run the tests
runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
}); 