import { researchVesselCombined } from './vessel-technical-combined-agent';
import * as fs from 'fs/promises';
import * as path from 'path';

async function testCombinedResearch() {
  try {
    const query = "Analyze my budget of my vessel and tell me all the recent purchase requisitions as well... My vessel is am kirti";
    
    console.log('Starting research...');
    console.log('Logs will be written to the logs directory');
    
    const result = await researchVesselCombined(query);
    
    // Get the log file path
    const timestamp = new Date().toISOString().split('T')[0];
    const logFile = path.join('logs', `vessel-research-${timestamp}.log`);
    
    // Save the complete analysis to a file
    const fullReport = [
      '# Combined Vessel Analysis Report',
      '## Query',
      query,
      '\n## Key Findings',
      ...result.learnings.map((learning, index) => `${index + 1}. ${learning}`),
      '\n## Detailed Analysis',
      result.report,
      '\n## Data Sources',
      ...result.visitedUrls.map((url, index) => `${index + 1}. ${url}`),
      '\n## Research Log',
      `Complete research log can be found at: ${logFile}`,
    ].join('\n\n');

    await fs.writeFile('vessel-analysis.md', fullReport, 'utf-8');
    console.log('\nComplete analysis has been saved to vessel-analysis.md');
    console.log(`Research logs have been saved to ${logFile}`);
    
  } catch (error) {
    console.error('Error running combined research:', error);
  }
}

// Run the test
testCombinedResearch().catch(console.error); 