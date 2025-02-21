import { deepResearch, AgentApiConfig, writeFinalReport } from '../deep-research';
import * as fs from 'fs/promises';

// Enhanced progress interface
interface ResearchProgress {
  currentDepth: number;
  totalDepth: number;
  currentBreadth: number;
  totalBreadth: number;
  currentQuery?: string;
  totalQueries: number;
  completedQueries: number;
  currentLearnings?: string[];
  currentUrls?: string[];
}

// Interface to track intermediate results
interface IntermediateResults {
  currentDepth: number;
  currentQuery: string;
  learnings: string[];
  visitedUrls: string[];
  timestamp: Date;
}

async function testYouTubeResearch() {
  const baseUrl = 'http://localhost:3001'; // Note: Different port from the main API

  // Track intermediate results
  const intermediateResults: IntermediateResults[] = [];

  // First test if the YouTube API is running
  try {
    const testResponse = await fetch(`${baseUrl}/api/test`);
    if (!testResponse.ok) {
      throw new Error('YouTube API server is not responding');
    }
    console.log('YouTube API server is running:', await testResponse.json());
  } catch (error) {
    console.error('Failed to connect to YouTube API server:', error);
    return;
  }

  // Create the YouTube API configuration
  const youtubeApiConfig: AgentApiConfig = {
    queryGeneratorEndpoint: {
      url: `${baseUrl}/api/generate-queries`,
      method: 'POST',
    },
    searchEndpoint: {
      url: `${baseUrl}/api/search`,
      method: 'POST',
    },
    resultProcessorEndpoint: {
      url: `${baseUrl}/api/process-results`,
      method: 'POST',
    },
    systemPrompt: "You are a YouTube research expert specialized in extracting knowledge from video content...",
  };

  try {
    console.log('Starting YouTube research...');
    const query = "How to build a successful SaaS startup?";
    
    // Use the deep research function with YouTube API
    const result = await deepResearch({
      query,
      breadth: 3, // Will generate 3 different YouTube search queries
      depth: 2,   // Will do 2 levels of follow-up research
      agentApiConfig: youtubeApiConfig,
      onProgress: (progress: ResearchProgress) => {
        console.log('Research Progress:', JSON.stringify(progress, null, 2));

        // Save intermediate results if we have new learnings
        const currentLearnings = progress.currentLearnings || [];
        const currentUrls = progress.currentUrls || [];

        if (currentLearnings.length > 0) {
          intermediateResults.push({
            currentDepth: progress.currentDepth,
            currentQuery: progress.currentQuery || 'Unknown query',
            learnings: currentLearnings,
            visitedUrls: currentUrls,
            timestamp: new Date(),
          });

          // Log intermediate findings
          console.log('\nIntermediate Findings:');
          console.log(`Depth: ${progress.currentDepth}`);
          console.log(`Query: ${progress.currentQuery || 'Unknown query'}`);
          console.log('New Learnings:');
          currentLearnings.forEach((learning: string, i: number) => {
            console.log(`${i + 1}. ${learning}`);
          });
          if (currentUrls.length > 0) {
            console.log('New Sources:');
            currentUrls.forEach((url: string) => console.log(`- ${url}`));
          }
          console.log('----------------------------------------');
        }
      },
    });

    console.log('Research completed!');
    console.log('Total learnings:', result.learnings.length);
    console.log('Sample learnings:', result.learnings.slice(0, 3));
    console.log('Total videos analyzed:', result.visitedUrls.length);

    // Generate and save the final report
    console.log('\nGenerating final report from YouTube research...');
    const report = await writeFinalReport({
      prompt: query,
      learnings: result.learnings,
      visitedUrls: result.visitedUrls,
    });

    // Save report
    const outputFile = 'youtube-research-output.md';
    await fs.writeFile(outputFile, report, 'utf-8');

    // Save intermediate results to a separate file
    const intermediateFile = 'youtube-research-intermediate.json';
    await fs.writeFile(
      intermediateFile,
      JSON.stringify({
        query,
        intermediateResults,
        timestamp: new Date(),
        totalLearnings: result.learnings.length,
        totalUrls: result.visitedUrls.length,
      }, null, 2),
      'utf-8'
    );

    console.log(`\nYouTube Research Report has been saved to ${outputFile}`);
    console.log(`Intermediate results have been saved to ${intermediateFile}`);
    console.log('\nReport Preview:');
    console.log('----------------------------------------');
    console.log(report.slice(0, 500) + '...'); // Show first 500 characters
    console.log('----------------------------------------');

    // Print summary of intermediate findings
    console.log('\nSummary of Research Progress:');
    intermediateResults.forEach((result, index) => {
      console.log(`\nStep ${index + 1}:`);
      console.log(`Depth: ${result.currentDepth}`);
      console.log(`Query: ${result.currentQuery}`);
      console.log(`Learnings: ${result.learnings.length}`);
      console.log(`Sources: ${result.visitedUrls.length}`);
      console.log(`Timestamp: ${result.timestamp}`);
    });

  } catch (error) {
    console.error('Error during YouTube research:', error);
    if (error instanceof Error) {
      console.error('Error stack:', error.stack);
    }
  }
}

// Add npm script command
if (require.main === module) {
  testYouTubeResearch().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
} 