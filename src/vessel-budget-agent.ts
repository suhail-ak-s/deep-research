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

// Define the specialized vessel budget analysis tools
export const vesselBudgetTools: AgentTools = {
  queryGenerators: [{
    metadata: {
      name: 'Vessel Budget Query Generator',
      description: 'Specialized in vessel budget and financial analysis queries',
      capabilities: ['budget_analysis', 'cost_analysis'],
      preferredQueries: ['budget', 'cost', 'expense', 'maintenance', 'financial'],
    },
    generateQueries: async (params) => {
      try {
        const res = await generateObject({
          model: o3MiniModel,
          system: `You are a vessel technical expert specializing in maritime budget analysis and financial planning.
Your goal is to analyze vessel budgets and extract meaningful patterns and insights about cost allocation and utilization.
Focus on understanding budget trends, cost patterns, and financial optimization opportunities.`,
          prompt: `Analyze the following vessel budget analysis request:

Original Query: ${params.query}

${params.learnings ? `Consider these previous findings:\n${params.learnings.join('\n')}` : ''}

Generate queries that will help analyze:
1. Budget allocation patterns and trends
2. Cost distribution across categories
3. Maintenance and repair expenses
4. Operating cost analysis
5. Budget utilization efficiency
6. Financial performance metrics
7. Cost optimization opportunities

Return focused queries that will extract meaningful budget insights.`,
          schema: z.object({
            queries: z.array(
              z.object({
                query: z.string().describe('Specific query about vessel budget analysis'),
                researchGoal: z.string().describe('What specific budget and financial information this query will gather'),
              })
            ).describe('List of focused budget analysis queries'),
          }),
        });

        // Limit the number of queries here instead of in the schema
        return res.object.queries.slice(0, params.numQueries || 3);
      } catch (error) {
        console.error('Budget query generation error:', error);
        throw error;
      }
    },
  }],
  searchers: [{
    metadata: {
      name: 'Budget Analysis Searcher',
      description: 'Searches vessel budget and financial data',
      capabilities: ['budget_analysis', 'financial_analysis'],
    },
    search: async (query: string) => {
      try {
        const response = await fetch('https://n8n.syia.ai/webhook/budget_subagent_anna', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query }),
        });

        if (!response.ok) {
          throw new Error(`Budget webhook returned ${response.status}`);
        }

        const data = await response.json() as WebhookResponse[];
        console.log('Raw webhook response:', JSON.stringify(data, null, 2));

        // Extract the output from the webhook response
        const content = data[0]?.output || 'No budget data available';

        // Format as a search response
        return {
          success: true,
          data: [{
            markdown: content,
            url: 'https://n8n.syia.ai',
            title: 'Vessel Budget Analysis Data',
            description: 'Budget and financial analysis information',
          }]
        } as SearchResponse;
      } catch (error) {
        console.error('Budget search error:', error);
        throw error;
      }
    },
  }],
  resultProcessors: [{
    metadata: {
      name: 'Budget Result Processor',
      description: 'Processes vessel budget and financial results',
      capabilities: ['budget_analysis', 'financial_analysis'],
    },
    processResults: async (params) => {
      try {
        // Extract the content from search results
        const searchContent = params.result.data.map(item => item.markdown).join('\n\n');

        // Process the results using generateObject
        const res = await generateObject({
          model: o3MiniModel,
          system: `You are a vessel technical expert specializing in maritime budget analysis and financial planning.
Your goal is to analyze budget data and extract meaningful insights about cost patterns, utilization, and optimization opportunities.
Focus on identifying trends, anomalies, and areas for financial optimization.`,
          prompt: `Analyze the following vessel budget data and extract key findings and insights:

Search Query: ${params.query}

Data:
${searchContent}

Analyze and provide insights on:
1. Budget Allocation Analysis
   - Identify patterns in budget allocation
   - Analyze spending trends by category
   - Highlight any significant deviations

2. Cost Distribution
   - Evaluate distribution of costs across categories
   - Identify major cost centers
   - Note any unusual spending patterns

3. Maintenance Expenses
   - Analyze maintenance cost patterns
   - Identify recurring maintenance expenses
   - Note any cost-saving opportunities

4. Operating Costs
   - Evaluate operational expense trends
   - Identify fixed vs variable costs
   - Note any efficiency opportunities

5. Budget Performance
   - Analyze budget vs actual spending
   - Identify areas of over/under utilization
   - Note any optimization opportunities

6. Financial Metrics
   - Calculate key performance indicators
   - Track cost per operating day
   - Note any concerning trends

Provide concrete, actionable insights that can help optimize budget utilization and reduce costs.`,
          schema: z.object({
            analysis: z.object({
              learnings: z.array(z.string().describe('Key finding about vessel budget analysis')),
              followUpQuestions: z.array(z.string().describe('Specific questions to gather more budget and financial details')),
            }).describe('Analysis of vessel budget data'),
          }),
        });

        return {
          learnings: res.object.analysis.learnings,
          followUpQuestions: res.object.analysis.followUpQuestions,
        };
      } catch (error) {
        console.error('Budget result processing error:', error);
        throw error;
      }
    },
  }],
};

export async function researchVesselBudget(query: string) {
  try {
    console.log('Starting vessel budget research...');
    console.log('Query:', query);
    
    const result = await deepResearch({
      query,
      breadth: 3,  // Number of parallel queries to run
      depth: 2,    // How deep to go in the research
      agentTools: vesselBudgetTools,
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
    console.error('Error during vessel budget research:', error);
    throw error;
  }
} 