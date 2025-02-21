import { deepResearch, AgentTools, writeFinalReport } from './deep-research';
import { SearchResponse } from '@mendable/firecrawl-js';
import { generateObject } from 'ai';
import { z } from 'zod';
import { o3MiniModel } from './ai/providers';
import { vesselBudgetTools } from './vessel-budget-agent';
import { vesselTechnicalPurchaseTools } from './vessel-technical-purchase-agent';
import { OutputManager } from './output-manager';
import * as fs from 'fs/promises';
import * as path from 'path';

// Initialize output manager for coordinated console/progress output
const output = new OutputManager();

// Create logs directory if it doesn't exist
async function ensureLogsDirectory() {
    try {
        await fs.mkdir('logs', { recursive: true });
    } catch (error) {
        console.error('Error creating logs directory:', error);
    }
}

// Helper function for consistent logging
async function log(...args: any[]) {
    const message = args.join(' ');
    output.log(message);
    
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const logFile = path.join('logs', `vessel-research-${timestamp.split('T')[0]}.log`);
        await fs.appendFile(logFile, message + '\n', 'utf-8');
    } catch (error) {
        console.error('Error writing to log file:', error);
    }
}

// Helper function for step logging with substeps
async function logStep(step: string, details?: string, substep: boolean = false) {
    const timestamp = new Date().toISOString().split('T')[1]?.slice(0, -1) || '';
    const prefix = substep ? '   └─' : '\n[${timestamp}] 🔄';
    await log(`${prefix} ${step}`);
    if (details) {
        await log(`      ${details}`);
    }
}

// Helper function for success logging
async function logSuccess(message: string, details?: string) {
    const timestamp = new Date().toISOString().split('T')[1]?.slice(0, -1) || '';
    await log(`\n[${timestamp}] ✅ ${message}`);
    if (details) {
        await log(`      ${details}`);
    }
}

// Helper function for info logging
async function logInfo(message: string, indent: number = 1) {
    const indentation = '  '.repeat(indent);
    await log(`${indentation}ℹ️  ${message}`);
}

// Helper function for query analysis logging
async function logQueryAnalysis(query: string) {
    await logStep('Query Analysis');
    await logInfo(`Original Query: "${query}"`, 2);
    
    // Analyze query components
    const components = {
        hasVessel: query.toLowerCase().includes('vessel'),
        hasBudget: query.toLowerCase().includes('budget'),
        hasPurchase: query.toLowerCase().includes('purchase'),
        hasTimeframe: query.toLowerCase().includes('2024') || query.toLowerCase().includes('recent'),
    };

    await logInfo('Query Components:', 2);
    for (const [key, value] of Object.entries(components)) {
        await logInfo(`${key}: ${value ? 'Yes' : 'No'}`, 3);
    }
}

// Define webhook response types
interface WebhookResponse {
    output: string;
    [key: string]: any;
}

// Tool selection helper with enhanced logging
function analyzeQueryIntent(query: string) {
    logStep('Intent Analysis');
    const queryLower = query.toLowerCase();
    
    // Detailed keyword analysis
    const keywords = {
        budget: ['budget', 'cost', 'expense', 'financial', 'spend', 'allocation'],
        purchase: ['purchase', 'requisition', 'procurement', 'vendor', 'order', 'buy'],
    };

    const matchedKeywords = {
        budget: keywords.budget.filter(kw => queryLower.includes(kw)),
        purchase: keywords.purchase.filter(kw => queryLower.includes(kw)),
    };

    logInfo('Matched Keywords:', 2);
    logInfo(`Budget Keywords: ${matchedKeywords.budget.join(', ') || 'none'}`, 3);
    logInfo(`Purchase Keywords: ${matchedKeywords.purchase.join(', ') || 'none'}`, 3);

    const intent = {
        isBudgetQuery: matchedKeywords.budget.length > 0,
        isPurchaseQuery: matchedKeywords.purchase.length > 0,
    };
    
    logInfo('Analysis Results:', 2);
    logInfo(`Budget Analysis Required: ${intent.isBudgetQuery}`, 3);
    logInfo(`Purchase Analysis Required: ${intent.isPurchaseQuery}`, 3);
    
    return intent;
}

// Helper function to extract vessel name with enhanced logging
function extractVesselName(query: string): string {
    logStep('Vessel Identification');
    const vesselNameMatch = query.match(/vessel\s+(?:is\s+)?([a-zA-Z\s]+)/i);
    const vesselName = vesselNameMatch?.[1]?.trim() || 'the vessel';
    
    logInfo('Extraction Details:', 2);
    logInfo(`Pattern Used: "vessel (is)? [name]"`, 3);
    logInfo(`Matched Text: ${vesselNameMatch?.[0] || 'none'}`, 3);
    logInfo(`Extracted Name: ${vesselName}`, 3);
    
    return vesselName;
}

export async function researchVesselCombined(query: string) {
    try {
        await ensureLogsDirectory();
        
        await log('\n=== Starting Combined Vessel Research ===\n');
        await log(`Original Query: "${query}"\n`);
        
        const vesselName = extractVesselName(query);
        const intent = analyzeQueryIntent(query);

        let allLearnings: string[] = [];
        let allUrls: string[] = [];

        // Budget Analysis Phase
        if (intent.isBudgetQuery || !intent.isPurchaseQuery) {
            await log('\n=== Budget Analysis Phase ===\n');
            const budgetQuery = `Analyze the budget and financial aspects for vessel ${vesselName}. ${query}`;
            await log(`Base Query: "${budgetQuery}"\n`);
            
            // Generate queries
            const queryGenerator = vesselBudgetTools.queryGenerators[0];
            if (queryGenerator) {
                await log('Generating Budget Research Queries...');
                const budgetQueries = await queryGenerator.generateQueries({
                    query: budgetQuery,
                    numQueries: 2,
                });

                await log(`Created ${budgetQueries.length} queries [`);
                for (const [index, q] of budgetQueries.entries()) {
                    await log(`  {`);
                    await log(`    query: "${q.query}",`);
                    if (q.researchGoal) {
                        await log(`    researchGoal: "${q.researchGoal}"`);
                    }
                    await log(`  }${index < budgetQueries.length - 1 ? ',' : ''}`);
                }
                await log(`]\n`);
            }
            
            // Perform budget research
            await log('Starting Budget Research...\n');
            const budgetResult = await deepResearch({
                query: budgetQuery,
                breadth: 2,
                depth: 2,
                learnings: [],
                agentTools: vesselBudgetTools,
                onProgress: (progress) => {
                    if (progress.currentQuery) {
                        log(`\nResearching Budget Query: "${progress.currentQuery}"\n`);
                    }
                    output.updateProgress({
                        ...progress,
                        currentQuery: progress.currentQuery ? `[Budget] ${progress.currentQuery}` : undefined,
                    });
                },
                onSearchStart: async (searcher, query) => {
                    await log(`Selected searcher: ${searcher.metadata.name}`);
                },
                onSearchComplete: async (response) => {
                    await log(`Raw webhook response: ${JSON.stringify(response.data, null, 2)}`);
                },
                onProcessStart: async (processor, query) => {
                    await log(`Selected result processor: ${processor.metadata.name}`);
                },
                onProcessComplete: async (results) => {
                    if (results.learnings.length > 0) {
                        await log(`Created ${results.learnings.length} learnings [`);
                        for (const [index, learning] of results.learnings.entries()) {
                            await log(`  "${learning}"${index < results.learnings.length - 1 ? ',' : ''}`);
                        }
                        await log(`]\n`);
                    }
                },
            });

            // Log budget learnings
            if (budgetResult.learnings.length > 0) {
                await log(`\nCreated ${budgetResult.learnings.length} learnings [`);
                for (const [index, learning] of budgetResult.learnings.entries()) {
                    await log(`  "${learning}"${index < budgetResult.learnings.length - 1 ? ',' : ''}`);
                }
                await log(`]\n`);
            }

            allLearnings.push(...budgetResult.learnings);
            allUrls.push(...budgetResult.visitedUrls);
        }

        // Purchase Analysis Phase
        if (intent.isPurchaseQuery || !intent.isBudgetQuery) {
            log('\n=== Purchase Analysis Phase ===\n');
            const purchaseQuery = `Analyze the purchase requisitions and procurement for vessel ${vesselName}. ${query}`;
            log(`Base Query: "${purchaseQuery}"\n`);
            
            // Generate queries
            const purchaseQueryGenerator = vesselTechnicalPurchaseTools.queryGenerators[0];
            if (purchaseQueryGenerator) {
                log('Generating Purchase Research Queries...');
                const purchaseQueries = await purchaseQueryGenerator.generateQueries({
                    query: purchaseQuery,
                    numQueries: 2,
                });

                log(`Created ${purchaseQueries.length} queries [`);
                purchaseQueries.forEach((q, index) => {
                    log(`  {`);
                    log(`    query: "${q.query}",`);
                    if (q.researchGoal) {
                        log(`    researchGoal: "${q.researchGoal}"`);
                    }
                    log(`  }${index < purchaseQueries.length - 1 ? ',' : ''}`);
                });
                log(`]\n`);
            }
            
            // Perform purchase research
            log('Starting Purchase Research...\n');
            const purchaseResult = await deepResearch({
                query: purchaseQuery,
                breadth: 2,
                depth: 2,
                learnings: allLearnings,
                agentTools: vesselTechnicalPurchaseTools,
                onProgress: (progress) => {
                    if (progress.currentQuery) {
                        log(`\nResearching Purchase Query: "${progress.currentQuery}"\n`);
                    }
                    output.updateProgress({
                        ...progress,
                        currentQuery: progress.currentQuery ? `[Purchase] ${progress.currentQuery}` : undefined,
                    });
                },
                onSearchStart: (searcher, query) => {
                    log(`Selected searcher: ${searcher.metadata.name}`);
                },
                onSearchComplete: (response) => {
                    log(`Raw webhook response: ${JSON.stringify(response.data, null, 2)}`);
                },
                onProcessStart: (processor, query) => {
                    log(`Selected result processor: ${processor.metadata.name}`);
                },
                onProcessComplete: (results) => {
                    if (results.learnings.length > 0) {
                        log(`Created ${results.learnings.length} learnings [`);
                        results.learnings.forEach((learning, index) => {
                            log(`  "${learning}"${index < results.learnings.length - 1 ? ',' : ''}`);
                        });
                        log(`]\n`);
                    }
                },
            });

            // Log purchase learnings
            if (purchaseResult.learnings.length > 0) {
                log(`\nCreated ${purchaseResult.learnings.length} learnings [`);
                purchaseResult.learnings.forEach((learning, index) => {
                    log(`  "${learning}"${index < purchaseResult.learnings.length - 1 ? ',' : ''}`);
                });
                log(`]\n`);
            }

            allLearnings.push(...purchaseResult.learnings);
            allUrls.push(...purchaseResult.visitedUrls);
        }

        // Final Results
        log('\n=== Final Results ===\n');
        
        if (allLearnings.length > 0) {
            log('\nLearnings:\n');
            for (const [index, learning] of allLearnings.entries()) {
                log(`${index + 1}. ${learning}\n`);
            }
        }

        const uniqueUrls = [...new Set(allUrls)];
        if (uniqueUrls.length > 0) {
            log(`\nVisited URLs (${uniqueUrls.length}):\n`);
            for (const [index, url] of uniqueUrls.entries()) {
                log(`${index + 1}. ${url}`);
            }
        }

        // Generate final report
        log('\nWriting final report...\n');
        const report = await writeFinalReport({
            prompt: query,
            learnings: allLearnings,
            visitedUrls: uniqueUrls,
        });

        return {
            success: true,
            learnings: allLearnings,
            report,
            visitedUrls: uniqueUrls,
        };

    } catch (error) {
        log('\n❌ Error During Research');
        console.error('Error details:', error);
        throw error;
    }
} 