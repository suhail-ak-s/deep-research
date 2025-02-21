import { researchVesselTechnicalPurchase } from './vessel-technical-purchase-agent';

async function testPurchaseResearch() {
  try {
    const query = "Analyze purchase requisitions from 2024 to present, focusing on: 1) Types of purchases and their priorities 2) Vendor performance and distribution 3) Cost patterns and budget utilization 4) Approval workflows and timelines";
    
    console.log('Starting research with query:', query);
    const result = await researchVesselTechnicalPurchase(query);
    
    // Print the results
    console.log('\n=== Research Results ===\n');
    
    if (result.learnings.length > 0) {
      console.log('Key Learnings:');
      result.learnings.forEach((learning, index) => {
        console.log(`${index + 1}. ${learning}`);
      });
    }
    
    console.log('\n=== Final Report ===\n');
    console.log(result.report);
    
  } catch (error) {
    console.error('Error running research:', error);
  }
}

// Run the test
testPurchaseResearch().catch(console.error); 