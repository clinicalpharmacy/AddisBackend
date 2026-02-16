# Polypharmacy Rule Implementation Guide

## Overview
This guide explains how to create and test a clinical rule that checks for polypharmacy (more than 10 medications).

## What is Polypharmacy?
Polypharmacy is the concurrent use of multiple medications by a patient. While there's no universally agreed-upon number, **taking 10 or more medications** is commonly considered polypharmacy and increases the risk of:
- Drug-drug interactions
- Adverse drug events
- Medication errors
- Non-adherence
- Increased healthcare costs

## Rule Configuration

### Rule Details
- **Rule Name**: Polypharmacy Alert - More Than 10 Medications
- **Rule Type**: `therapeutic_monitoring`
- **Severity**: `high`
- **DTP Category**: `monitoring_needed`

### Rule Condition (JSON)
```json
{
  "all": [
    {
      "fact": "medication_count",
      "operator": ">",
      "value": 10
    }
  ]
}
```

### Rule Action (JSON)
```json
{
  "message": "Polypharmacy detected: Patient is taking {{medication_count}} medications",
  "recommendation": "Patient is taking {{medication_count}} medications, which exceeds the polypharmacy threshold of 10. Consider:\n1. Medication reconciliation to identify duplicates or unnecessary medications\n2. Review for potential drug-drug interactions\n3. Assess patient adherence and understanding\n4. Evaluate for deprescribing opportunities\n5. Monitor for adverse drug events",
  "severity": "high"
}
```

## How to Add This Rule

### Option 1: Using the Clinical Rules Admin Interface

1. **Navigate to Clinical Rules Admin**
   - Log in as an admin user
   - Go to the Clinical Rules Administration page

2. **Create New Rule**
   - Click "Create New Rule" button
   - Fill in the form:
     - **Rule Name**: `Polypharmacy Alert - More Than 10 Medications`
     - **Rule Type**: Select `Therapeutic Monitoring`
     - **Severity**: Select `High`
     - **DTP Category**: Select `Monitoring Needed`
     - **Description**: `Alerts when a patient is taking more than 10 medications concurrently`

3. **Set Rule Condition**
   - In the "Rule Condition (JSON)" field, paste:
   ```json
   {
     "all": [
       {
         "fact": "medication_count",
         "operator": ">",
         "value": 10
       }
     ]
   }
   ```

4. **Set Rule Action**
   - In the "Rule Action (JSON)" field, paste:
   ```json
   {
     "message": "Polypharmacy detected: Patient is taking {{medication_count}} medications",
     "recommendation": "Patient is taking {{medication_count}} medications, which exceeds the polypharmacy threshold of 10. Consider:\n1. Medication reconciliation to identify duplicates or unnecessary medications\n2. Review for potential drug-drug interactions\n3. Assess patient adherence and understanding\n4. Evaluate for deprescribing opportunities\n5. Monitor for adverse drug events",
     "severity": "high"
   }
   ```

5. **Set Applies To**
   - Select: `All Patients`

6. **Save the Rule**
   - Click "Save Rule"
   - Ensure "Is Active" is checked

### Option 2: Using SQL (Direct Database Insert)

```sql
INSERT INTO clinical_rules (
  rule_name,
  rule_type,
  rule_description,
  rule_condition,
  rule_action,
  severity,
  dtp_category,
  is_active,
  applies_to,
  created_at,
  updated_at
) VALUES (
  'Polypharmacy Alert - More Than 10 Medications',
  'therapeutic_monitoring',
  'Alerts when a patient is taking more than 10 medications concurrently',
  '{"all": [{"fact": "medication_count", "operator": ">", "value": 10}]}',
  '{"message": "Polypharmacy detected: Patient is taking {{medication_count}} medications", "recommendation": "Patient is taking {{medication_count}} medications, which exceeds the polypharmacy threshold of 10. Consider:\\n1. Medication reconciliation to identify duplicates or unnecessary medications\\n2. Review for potential drug-drug interactions\\n3. Assess patient adherence and understanding\\n4. Evaluate for deprescribing opportunities\\n5. Monitor for adverse drug events", "severity": "high"}',
  'high',
  'monitoring_needed',
  true,
  ARRAY['all_patients'],
  NOW(),
  NOW()
);
```

## Testing the Rule

### Step 1: Create a Test Patient with 11+ Medications

1. **Create or Select a Patient**
   - Go to Patient Management
   - Create a new patient or select an existing one

2. **Add Multiple Medications**
   - Navigate to the patient's Medication History
   - Add at least 11 medications. Example medications:
     1. Metformin 500mg
     2. Lisinopril 10mg
     3. Atorvastatin 20mg
     4. Aspirin 81mg
     5. Omeprazole 20mg
     6. Levothyroxine 50mcg
     7. Amlodipine 5mg
     8. Metoprolol 25mg
     9. Furosemide 20mg
     10. Warfarin 5mg
     11. Insulin Glargine 10 units
     12. Gabapentin 300mg (optional - to exceed 11)

3. **Run CDSS Analysis**
   - Go to the CDSS/Clinical Decision Support page
   - Select the patient
   - Click "Analyze Patient" or wait for auto-analysis
   - The polypharmacy alert should appear

### Step 2: Verify the Alert

The alert should display:
- **Severity**: High (orange/red badge)
- **Message**: "Polypharmacy detected: Patient is taking 11 medications" (or however many you added)
- **Recommendation**: Detailed guidance on medication review

## Additional Polypharmacy Rules

You can create variations of this rule:

### Moderate Polypharmacy (5-9 medications)
```json
{
  "all": [
    {
      "fact": "medication_count",
      "operator": ">=",
      "value": 5
    },
    {
      "fact": "medication_count",
      "operator": "<=",
      "value": 9
    }
  ]
}
```
Severity: `moderate`

### Severe Polypharmacy (15+ medications)
```json
{
  "all": [
    {
      "fact": "medication_count",
      "operator": ">=",
      "value": 15
    }
  ]
}
```
Severity: `critical`

### Geriatric Polypharmacy (5+ medications in patients >65 years)
```json
{
  "all": [
    {
      "fact": "age",
      "operator": ">",
      "value": 65
    },
    {
      "fact": "medication_count",
      "operator": ">=",
      "value": 5
    }
  ]
}
```
Severity: `high`

## Troubleshooting

### Alert Not Triggering?

1. **Check medication count**
   - Verify the patient has more than 10 medications
   - Check the CDSS debug output for `medication_count` value

2. **Verify rule is active**
   - Go to Clinical Rules Admin
   - Ensure the rule's "Is Active" toggle is ON

3. **Check rule condition**
   - Ensure the JSON is valid
   - Verify the operator is `>` not `>=` if you want strictly more than 10

4. **Review CDSS logs**
   - Check browser console for CDSS evaluation logs
   - Look for the rule name in the evaluation output

### Medications Not Counting?

1. **Verify medication status**
   - Only active medications should count
   - Check that medications have `status: 'Active'` or `is_active: true`

2. **Check medication history table**
   - Ensure medications are saved in the `medication_history` table
   - Verify the `patient_code` matches

## Best Practices

1. **Regular Review**: Set up regular medication reviews for patients with polypharmacy
2. **Deprescribing**: Consider deprescribing unnecessary medications
3. **Patient Education**: Ensure patients understand all their medications
4. **Interaction Checking**: Always check for drug-drug interactions in polypharmacy patients
5. **Adherence Monitoring**: Polypharmacy increases non-adherence risk

## References

- Masnoon N, et al. What is polypharmacy? A systematic review of definitions. BMC Geriatr. 2017;17(1):230.
- American Geriatrics Society. Updated Beers Criteria for Potentially Inappropriate Medication Use in Older Adults.
