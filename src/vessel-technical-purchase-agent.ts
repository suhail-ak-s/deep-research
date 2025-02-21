import { deepResearch, AgentTools, writeFinalReport } from './deep-research';
import { SearchResponse } from '@mendable/firecrawl-js';
import { generateObject } from 'ai';
import { z } from 'zod';
import { o3MiniModel } from './ai/providers';

// Define webhook response types
interface WebhookResponse {
  output: string;
  [key: string]: any;
}

// Define the specialized vessel technical purchase tools
export const vesselTechnicalPurchaseTools: AgentTools = {
  queryGenerators: [{
    metadata: {
      name: 'Vessel Purchase Query Generator',
      description: 'Specialized in vessel purchase and procurement queries',
      capabilities: ['purchase_analysis'],
      preferredQueries: ['purchase', 'procurement', 'requisition', 'vendor', 'supplier'],
    },
    generateQueries: async (params) => {
      try {
        const res = await generateObject({
          model: o3MiniModel,
          system: `You are a vessel technical expert specializing in maritime procurement and purchase analysis.
Your goal is to analyze purchase requisitions and extract meaningful patterns and insights.
Focus on understanding procurement trends, vendor performance, and technical requirements.`,
          prompt: `Analyze the following vessel purchase requisition request:

Original Query: ${params.query}

${params.learnings ? `Consider these previous findings:\n${params.learnings.join('\n')}` : ''}

Generate queries that will help analyze:
1. Purchase requisition patterns and trends
2. Vendor distribution and performance
3. Technical specifications and requirements
4. Cost analysis and budget utilization
5. Delivery timelines and logistics
6. Requisition status and approval workflows

Return focused queries that will extract meaningful procurement insights.`,
          schema: z.object({
            queries: z.array(
              z.object({
                query: z.string().describe('Specific query about vessel technical purchases'),
                researchGoal: z.string().describe('What specific technical and procurement information this query will gather'),
              })
            ).describe('List of focused technical procurement queries'),
          }),
        });

        // Limit the number of queries here instead of in the schema
        return res.object.queries.slice(0, params.numQueries || 3);
      } catch (error) {
        console.error('Purchase query generation error:', error);
        throw error;
      }
    },
  }],
  searchers: [{
    metadata: {
      name: 'Purchase Technical Searcher',
      description: 'Searches vessel purchase and technical specifications',
      capabilities: ['purchase_analysis', 'technical_specs'],
    },
    search: async (query: string) => {
      try {
        const response = await fetch('https://n8n.syia.ai/webhook/purchase_agent_anna', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query }),
        });

        if (!response.ok) {
          throw new Error(`Purchase webhook returned ${response.status}`);
        }

        const data = await response.json() as WebhookResponse[];
        console.log('Raw webhook response:', JSON.stringify(data, null, 2));

        // Extract the output from the webhook response
        const content = data[0]?.output || 'No purchase data available';

        // Format as a search response
        return {
          success: true,
          data: [{
            markdown: content,
            url: 'https://n8n.syia.ai',
            title: 'Vessel Technical Purchase Data',
            description: 'Technical specifications and purchase information',
          }]
        } as SearchResponse;
      } catch (error) {
        console.error('Purchase search error:', error);
        throw error;
      }
    },
  }],
  resultProcessors: [{
    metadata: {
      name: 'Purchase Technical Result Processor',
      description: 'Processes vessel purchase and technical results',
      capabilities: ['purchase_analysis', 'technical_specs'],
    },
    processResults: async (params) => {
      try {
        // Extract the content from search results
        const searchContent = params.result.data.map(item => item.markdown).join('\n\n');

        // Process the results using generateObject
        const res = await generateObject({
          model: o3MiniModel,
          system: `You are a vessel technical expert specializing in maritime procurement and technical analysis.
Your goal is to analyze purchase requisition data and extract meaningful insights about procurement patterns, vendor performance, and technical requirements.
Focus on identifying trends, anomalies, and areas for optimization in the procurement process.`,
          prompt: `Analyze the following purchase requisition data and extract key findings and insights:

Search Query: ${params.query}

Data:
${searchContent}

Analyze and provide insights on:
1. Purchase Requisition Analysis
   - Identify patterns in requisition types and priorities
   - Analyze approval workflows and timelines
   - Highlight any bottlenecks or delays

2. Vendor Analysis
   - Evaluate vendor distribution and performance
   - Identify preferred vendors and their specialties
   - Note any vendor-related issues or concerns

3. Technical Requirements
   - Categorize types of technical purchases
   - Identify common technical specifications
   - Note any recurring technical needs

4. Cost and Budget Analysis
   - Analyze cost patterns and trends
   - Identify budget utilization patterns
   - Note any cost optimization opportunities

5. Timeline and Logistics
   - Evaluate delivery performance
   - Identify logistics patterns
   - Note any timeline-related issues

Provide concrete, actionable insights that can help improve the procurement process.`,
          schema: z.object({
            analysis: z.object({
              learnings: z.array(z.string().describe('Key finding about vessel technical purchases')),
              followUpQuestions: z.array(z.string().describe('Specific questions to gather more technical and procurement details')),
            }).describe('Analysis of vessel technical purchase data'),
          }),
        });

        return {
          learnings: res.object.analysis.learnings,
          followUpQuestions: res.object.analysis.followUpQuestions,
        };
      } catch (error) {
        console.error('Purchase result processing error:', error);
        throw error;
      }
    },
  }],
};

export async function researchVesselTechnicalPurchase(query: string) {
  try {
    console.log('Starting vessel technical purchase research...');
    console.log('Query:', query);
    
    const result = await deepResearch({
      query,
      breadth: 3,  // Number of parallel queries to run
      depth: 2,    // How deep to go in the research
      agentTools: vesselTechnicalPurchaseTools,
      onProgress: (progress) => {
        console.log('Research Progress:', JSON.stringify(progress, null, 2));
      },
    });

    console.log('Research completed!');
    console.log('Total learnings:', result.learnings.length);

    // Generate the final report
    console.log('Generating final report...');
    const report = await writeFinalReport({
      prompt: query,
      learnings: result.learnings,
      visitedUrls: result.visitedUrls,
    });

    return {
      success: true,
      learnings: result.learnings,
      report,
    };

  } catch (error) {
    console.error('Error during vessel technical purchase research:', error);
    throw error;
  }
} 