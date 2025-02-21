import { researchVesselBudget } from './vessel-budget-agent';

async function testBudgetResearch() {
  try {
    const query = "Analyze vessel budget data from 2024 to present, focusing on: 1) Budget allocation patterns and trends 2) Cost distribution across categories 3) Maintenance and repair expenses 4) Operating cost analysis 5) Budget utilization efficiency";
    
    console.log('Starting budget research with query:', query);
    const result = await researchVesselBudget(query);
    
    // Print the results
    console.log('\n=== Budget Research Results ===\n');
    
    if (result.learnings.length > 0) {
      console.log('Key Budget Learnings:');
      result.learnings.forEach((learning, index) => {
        console.log(`${index + 1}. ${learning}`);
      });
    }
    
    console.log('\n=== Final Budget Report ===\n');
    console.log(result.report);
    
  } catch (error) {
    console.error('Error running budget research:', error);
  }
}

// Run the test
testBudgetResearch().catch(console.error); 