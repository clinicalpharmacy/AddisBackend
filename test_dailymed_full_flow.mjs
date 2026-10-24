import axios from 'axios';

async function testFullFlow() {
  try {
    const baseUrl = 'http://localhost:3000/api/dailymed';

    console.log("==========================================");
    console.log("STEP 1: Search DailyMed for 'metformin'");
    console.log("==========================================");
    const searchRes = await axios.get(`${baseUrl}/search?drug=metformin`);
    console.log(`✅ Search status: ${searchRes.status}`);
    console.log(`✅ Total labels found: ${searchRes.data.total}`);
    console.log(`✅ Returned labels: ${searchRes.data.labels.length}`);
    
    const sampleLabel = searchRes.data.labels[0];
    console.log("Selected Label to Import:", {
      setid: sampleLabel.setid,
      title: sampleLabel.title
    });

    console.log("\n==========================================");
    console.log("STEP 2: Import label & extract dosage section");
    console.log("==========================================");
    const importRes = await axios.post(`${baseUrl}/import`, {
      setid: sampleLabel.setid,
      drug_name: 'Metformin'
    });
    console.log(`✅ Import status: ${importRes.status}`);
    console.log(`✅ Imported ID: ${importRes.data.label.id}`);
    console.log(`✅ Review status: ${importRes.data.label.review_status}`);
    console.log(`✅ Title: ${importRes.data.label.label_title}`);
    console.log("Extracted Dosage Preview:");
    console.log(importRes.data.label.dosage_text.substring(0, 300) + '...\n');

    console.log("==========================================");
    console.log("STEP 3: Retrieve imported labels from Supabase");
    console.log("==========================================");
    const listRes = await axios.get(`${baseUrl}/labels`);
    console.log(`✅ Stored labels in Supabase count: ${listRes.data.count}`);

    console.log("\n==========================================");
    console.log("STEP 4: Test Clinical Review (Approve)");
    console.log("==========================================");
    const labelId = importRes.data.label.id;
    const reviewRes = await axios.patch(`${baseUrl}/labels/${labelId}/status`, {
      review_status: 'approved'
    });
    console.log(`✅ Review update status: ${reviewRes.status}`);
    console.log(`✅ New status: ${reviewRes.data.label.review_status}`);
    console.log(`✅ Reviewed at: ${reviewRes.data.label.reviewed_at}`);

    console.log("\n🎉 ALL 4 DAILYMED PROTOTYPE STEPS PASSED SUCCESSFULLY!");
  } catch (err) {
    console.error("❌ Test failed:", err.message);
    if (err.response) {
      console.error("Response data:", err.response.data);
    }
  }
}

testFullFlow();
