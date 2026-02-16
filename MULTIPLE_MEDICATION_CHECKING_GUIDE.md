# Pregnancy Contraindicated Medications - Multiple Drug Checking Guide

## Overview
This guide explains how to create clinical rules that check **multiple medications at once** for pregnancy contraindications. Instead of creating one rule per medication, we use the `"any"` operator to check if a pregnant patient is taking ANY medication from a list.

## How It Works

### Rule Structure with Multiple Medications

The key is using **nested conditions** with `"all"` and `"any"` operators:

```json
{
  "all": [
    {
      "fact": "is_pregnant",
      "operator": "equals",
      "value": true
    },
    {
      "any": [
        {"fact": "medications", "operator": "contains", "value": "medication1"},
        {"fact": "medications", "operator": "contains", "value": "medication2"},
        {"fact": "medications", "operator": "contains", "value": "medication3"}
      ]
    }
  ]
}
```

**Translation**: 
- The patient **MUST** be pregnant (`"all"` condition)
- **AND** the patient is taking **ANY ONE** of the listed medications (`"any"` condition)

## Example: Category X Medications (Absolutely Contraindicated)

### Complete Rule Configuration

**Rule Name**: Pregnancy - Category X Medications Contraindicated

**Rule Type**: `pregnancy_check`

**Severity**: `critical`

**Rule Condition**:
```json
{
  "all": [
    {
      "fact": "is_pregnant",
      "operator": "equals",
      "value": true
    },
    {
      "any": [
        {"fact": "medications", "operator": "contains", "value": "isotretinoin"},
        {"fact": "medications", "operator": "contains", "value": "accutane"},
        {"fact": "medications", "operator": "contains", "value": "thalidomide"},
        {"fact": "medications", "operator": "contains", "value": "methotrexate"},
        {"fact": "medications", "operator": "contains", "value": "misoprostol"},
        {"fact": "medications", "operator": "contains", "value": "finasteride"},
        {"fact": "medications", "operator": "contains", "value": "warfarin"},
        {"fact": "medications", "operator": "contains", "value": "atorvastatin"},
        {"fact": "medications", "operator": "contains", "value": "simvastatin"},
        {"fact": "medications", "operator": "contains", "value": "rosuvastatin"},
        {"fact": "medications", "operator": "contains", "value": "lovastatin"},
        {"fact": "medications", "operator": "contains", "value": "pravastatin"},
        {"fact": "medications", "operator": "contains", "value": "ribavirin"},
        {"fact": "medications", "operator": "contains", "value": "leflunomide"},
        {"fact": "medications", "operator": "contains", "value": "mycophenolate"}
      ]
    }
  ]
}
```

**Rule Action**:
```json
{
  "message": "CONTRAINDICATED: Pregnancy Category X medication detected",
  "recommendation": "CRITICAL ALERT: Patient is pregnant ({{pregnancy_weeks}} weeks) and is taking a Category X medication that is ABSOLUTELY CONTRAINDICATED in pregnancy.\n\nIMMEDIATE ACTIONS REQUIRED:\n1. STOP the contraindicated medication immediately\n2. Notify prescribing physician urgently\n3. Assess fetal exposure duration and timing\n4. Consider teratology consultation\n5. Discuss risks with patient\n6. Document in medical record\n7. Replace with pregnancy-safe alternative if needed\n8. Arrange appropriate fetal monitoring",
  "severity": "critical"
}
```

## Categories of Pregnancy-Contraindicated Medications

### 1. **Category X Medications** (Absolutely Contraindicated)
- **Isotretinoin (Accutane)** - Severe birth defects
- **Thalidomide** - Limb malformations
- **Methotrexate** - Neural tube defects, abortion
- **Warfarin** - Fetal warfarin syndrome
- **All Statins** - Skeletal malformations
- **Misoprostol** - Uterine contractions, abortion
- **Finasteride/Dutasteride** - Male genital abnormalities
- **Ribavirin** - Teratogenic and embryocidal

### 2. **ACE Inhibitors & ARBs** (Especially 2nd/3rd Trimester)
- **ACE Inhibitors**: Lisinopril, Enalapril, Ramipril, Captopril, Benazepril
- **ARBs**: Losartan, Valsartan, Irbesartan, Candesartan, Olmesartan
- **Risks**: Oligohydramnios, fetal renal dysfunction, skull hypoplasia

### 3. **NSAIDs** (Especially 3rd Trimester, >30 weeks)
- Ibuprofen, Naproxen, Diclofenac, Indomethacin, Ketorolac
- **Risks**: Premature ductus arteriosus closure, pulmonary hypertension

### 4. **Tetracycline Antibiotics**
- Tetracycline, Doxycycline, Minocycline
- **Risks**: Permanent tooth discoloration, bone growth impairment

### 5. **Fluoroquinolones**
- Ciprofloxacin, Levofloxacin, Moxifloxacin
- **Risks**: Cartilage damage, arthropathy

### 6. **High-Risk Antiepileptic Drugs**
- **Valproic Acid** - Neural tube defects, cognitive impairment
- **Phenytoin** - Fetal hydantoin syndrome
- **Carbamazepine** - Neural tube defects
- **Topiramate** - Cleft lip/palate

## How to Add These Rules

### Method 1: Using SQL Script (Recommended)

1. **Run the SQL file**:
   ```bash
   # Connect to your database and run:
   psql -U your_username -d your_database -f pregnancy_contraindicated_medications.sql
   ```

2. **Verify the rules were added**:
   ```sql
   SELECT rule_name, severity, is_active 
   FROM clinical_rules 
   WHERE rule_name LIKE '%Pregnancy%';
   ```

### Method 2: Using Clinical Rules Admin Interface

1. Navigate to **Clinical Rules Administration**
2. Click **"Create New Rule"**
3. Copy and paste the JSON from the examples above
4. Save and activate the rule

## Testing the Rules

### Test Case 1: Pregnant Patient on Statin

1. **Create a test patient**:
   - Name: Jane Doe
   - Age: 28
   - Gender: Female
   - **Is Pregnant**: ✓ Yes
   - **Pregnancy Weeks**: 12
   - **Pregnancy Trimester**: First

2. **Add a contraindicated medication**:
   - Drug: Atorvastatin 20mg
   - Status: Active

3. **Run CDSS Analysis**:
   - Expected Alert: **"CONTRAINDICATED: Pregnancy Category X medication detected"**
   - Severity: **Critical**

### Test Case 2: Pregnant Patient on ACE Inhibitor

1. **Patient Setup**:
   - Pregnant: Yes
   - Pregnancy Weeks: 24 (2nd trimester)

2. **Add Medication**:
   - Drug: Lisinopril 10mg

3. **Expected Alert**:
   - **"CONTRAINDICATED: ACE Inhibitor/ARB in pregnancy"**
   - Severity: Critical

### Test Case 3: Pregnant Patient on NSAID (3rd Trimester)

1. **Patient Setup**:
   - Pregnant: Yes
   - Pregnancy Weeks: 32 (3rd trimester)

2. **Add Medication**:
   - Drug: Ibuprofen 400mg

3. **Expected Alert**:
   - **"WARNING: NSAID use in pregnancy"**
   - Severity: High

## Adding More Medications to Existing Rules

To add more medications to an existing rule:

1. **Find the rule** in Clinical Rules Admin
2. **Edit the rule**
3. **Add to the `"any"` array**:
   ```json
   {
     "any": [
       // ... existing medications ...
       {"fact": "medications", "operator": "contains", "value": "new_medication_name"}
     ]
   }
   ```
4. **Save the rule**

## Creating Your Own Multi-Medication Rules

### Template:

```json
{
  "all": [
    {
      "fact": "CONDITION_TO_CHECK",
      "operator": "equals",
      "value": true
    },
    {
      "any": [
        {"fact": "medications", "operator": "contains", "value": "drug1"},
        {"fact": "medications", "operator": "contains", "value": "drug2"},
        {"fact": "medications", "operator": "contains", "value": "drug3"}
        // Add as many as needed
      ]
    }
  ]
}
```

### Example Use Cases:

1. **Renal Impairment + Nephrotoxic Drugs**
   ```json
   {
     "all": [
       {"fact": "egfr", "operator": "<", "value": 30},
       {
         "any": [
           {"fact": "medications", "operator": "contains", "value": "gentamicin"},
           {"fact": "medications", "operator": "contains", "value": "vancomycin"},
           {"fact": "medications", "operator": "contains", "value": "nsaids"}
         ]
       }
     ]
   }
   ```

2. **Elderly + Beers Criteria Medications**
   ```json
   {
     "all": [
       {"fact": "age", "operator": ">", "value": 65},
       {
         "any": [
           {"fact": "medications", "operator": "contains", "value": "diphenhydramine"},
           {"fact": "medications", "operator": "contains", "value": "diazepam"},
           {"fact": "medications", "operator": "contains", "value": "amitriptyline"}
         ]
       }
     ]
   }
   ```

3. **Pediatric + Contraindicated Drugs**
   ```json
   {
     "all": [
       {"fact": "is_pediatric", "operator": "equals", "value": true},
       {
         "any": [
           {"fact": "medications", "operator": "contains", "value": "aspirin"},
           {"fact": "medications", "operator": "contains", "value": "tetracycline"},
           {"fact": "medications", "operator": "contains", "value": "fluoroquinolones"}
         ]
       }
     ]
   }
   ```

## Important Notes

### Medication Name Matching
- The system uses **case-insensitive** matching
- It checks **generic names**, **brand names**, and **drug classes**
- Example: "atorvastatin", "Lipitor", and "statins" will all match

### Pregnancy Status Detection
The system checks:
- `is_pregnant` field (boolean)
- `pregnancy_weeks` (number)
- `pregnancy_trimester` (string: "First", "Second", "Third")

### Alert Severity Levels
- **Critical**: Immediate action required, severe risk
- **High**: Urgent attention needed, significant risk
- **Moderate**: Should be addressed, moderate risk
- **Low**: Monitor, low risk

## Troubleshooting

### Alert Not Triggering?

1. **Check pregnancy status**:
   ```javascript
   // In browser console when viewing patient:
   console.log('Pregnancy status:', patientData.is_pregnant);
   console.log('Pregnancy weeks:', patientData.pregnancy_weeks);
   ```

2. **Verify medication names**:
   - Check exact spelling in medication history
   - Ensure medication status is "Active"

3. **Check rule is active**:
   - Go to Clinical Rules Admin
   - Verify "Is Active" toggle is ON

4. **Review CDSS debug output**:
   - Check browser console for rule evaluation logs

## Best Practices

1. **Include both generic and brand names** in the medication list
2. **Use lowercase** for medication names for consistency
3. **Group related medications** (e.g., all statins together)
4. **Provide clear, actionable recommendations** in the alert
5. **Include severity appropriate to the risk**
6. **Reference pregnancy trimester** when risk varies by trimester

## References

- FDA Pregnancy Categories (historical reference)
- ACOG Practice Bulletins on medication use in pregnancy
- Briggs' Drugs in Pregnancy and Lactation
- MotherToBaby (Organization of Teratology Information Specialists)
