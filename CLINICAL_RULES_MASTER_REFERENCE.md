# 🩺 CLINICAL RULES: THE COMPLETE MASTER REFERENCE

This document is the "Source of Truth" for creating Clinical Decision Support System (CDSS) rules. It covers every Logic type, Operator, and Patient Fact available in the system.

---

## 1. LOGIC BLOCKS (How to combine rules)
Logic blocks tell the system how to group your conditions.

| Logic Type | Meaning | When to use |
| :--- | :--- | :--- |
| **`all`** | **AND** | Every single item in the list must be true. |
| **`any`** | **OR** | At least one item in the list must be true. |
| **`not`** | **NOT** | The condition inside must be false. |

---

## 2. OPERATOR CHEAT SHEET (The "Logic" Symbols)
Operators define the mathematical or logical relationship between a **Fact** (the data) and a **Value** (your threshold).

### 🔢 Numerical Comparisons (For Labs, Vitals, and Age)
*   **`==` (Equal To)**: The value must be exactly this number.
    *   *Use case:* `age == 18` (Exactly 18 years old).
*   **`!=` (Not Equal To)**: The value must be anything *except* this number.
    *   *Use case:* `vitals.temperature != 37.0` (Temperature is not normal).
*   **`>` (Greater Than)**: The value must be higher than your threshold.
    *   *Use case:* `labs.potassium > 5.5` (Identifies Hyperkalemia).
*   **`<` (Less Than)**: The value must be lower than your threshold.
    *   *Use case:* `labs.egfr < 60` (Identifies Kidney dysfunction).
*   **`>=` (Greater Than or Equal To)**: Higher than or exactly the same as the threshold.
    *   *Use case:* `pregnancy_weeks >= 28` (3rd Trimester starts here).
*   **`<=` (Less Than or Equal To)**: Lower than or exactly the same as the threshold.
    *   *Use case:* `age_in_days <= 28` (Targets all Neonates).

### 📝 Text & List Comparisons (For Meds, Allergies, and Gender)
*   **`contains`**: Checks if a specific word is found inside a list. **Always use this for Medications.**
    *   *Use case:* `medications contains "warfarin"` (Patient is taking Warfarin).
*   **`not_contains`**: Checks that a word is **missing** from a list.
    *   *Use case:* `medication_names not_contains "aspirin"` (Patient is NOT on Aspirin).
*   **`in`**: Checks if a single Fact matches any value in a provided list.
    *   *Use case:* `gender in ["Male", "Female"]`.

---

## 3. ALL PATIENT FACTS (The "IF" Factors)
These are the specific data points retrieved from the patient's record during analysis.

### 👶 Demographics & Reproductive Health
*   **`age`**: The patient's chronological age in years. Use this for general adult vs. pediatric logic (e.g., `value: 18`) or geriatric screening (e.g., `value: 65`).
*   **`age_in_days`**: The exact age in days from birth. Essential for **Neonatal** (0-28 days) and **Infant** (29-365 days) dosing where years are not precise enough.
*   **`gender`**: Biological sex. Values are `"Male"` or `"Female"`. Useful for gender-specific lab ranges or medication risks.
*   **`is_pregnant`**: A simple `true`/`false` check. Triggers rules for "Category X" drugs or pregnancy-safe alternatives.
*   **`pregnancy_weeks`**: The current stage of gestation (1 to 42). Use this to target specific trimesters (e.g., `> 28` for the 3rd trimester where NSAID risks increase).
*   **`is_lactating`**: A `true`/`false` check to identify breastfeeding mothers. Use this to flag drugs that are excreted in breast milk (e.g., Metronidazole).

### 🌡️ Vitals (Real-time Physical Signs)
*   **`vitals.systolic`**: The top number of the blood pressure (mmHg). High values (`> 140`) may indicate hypertension.
*   **`vitals.diastolic`**: The bottom number of the blood pressure (mmHg).
*   **`vitals.heart_rate`**: Measured in beats per minute (BPM). Use to check for **Bradycardia** (`< 60`) or **Tachycardia** (`> 100`).
*   **`vitals.temperature`**: Body temperature in Celsius. Use `> 38.0` to detect fever.
*   **`vitals.oxygen_saturation`**: The SpO2 percentage. Flag values `< 92%` for potential respiratory distress or hypoxia.

### 🧪 Lab Results (Requires `labs.` prefix)
*   **Renal (Kidney)**:
    *   `creatinine`: Serum creatinine level (mg/dL). Higher values indicate lower kidney function.
    *   `egfr`: Estimated Glomerular Filtration Rate. This is the **most important** fact for renal dosing (e.g., `< 30` is severe impairment).
    *   `bun`: Blood Urea Nitrogen.
*   **Electrolytes**:
    *   `potassium`: Critical for cardiac meds (e.g., flag `> 5.5` or `< 3.5`).
    *   `sodium`: Check for hyponatremia (`< 135`).
*   **Hematology (Blood)**:
    *   `hemoglobin`: Check for anemia (e.g., `< 11`).
    *   `wbc_count`: High values indicate infection; low values indicate immunosuppression.
    *   `platelet_count`: Essential for surgery or blood thinners (e.g., `< 150` indicates bleeding risk).
*   **Metabolic**:
    *   `blood_sugar`: Random or fasting glucose. Use `> 200` to flag uncontrolled diabetes.
    *   `hba1c`: Long-term sugar control (%). Values `> 7.5` indicate a need for therapy review.
*   **Liver & Clotting**:
    *   `alt` / `ast`: Liver enzymes. Values `> 3x Normal` (e.g., `> 120`) indicate potential liver injury.
    *   `inr`: Standardized clotting time. Critical for **Warfarin** monitoring (e.g., flag if `> 3.5`).

### 💊 Medications, Allergies & History
*   **`medications`**: A complete list of active prescriptions. Use `contains` to see if a patient is on a specific drug (e.g., "aspirin").
*   **`medication_names`**: Similar to `medications`, but simplified to just the names for faster matching and fewer errors.
*   **`medication_count`**: The total number of active medications. Use this to trigger **Polypharmacy** alerts (e.g., `> 10` meds).
*   **`medication_dose`**: Checks the specific strength (mg/mcg/ml) of a drug. **Note:** This requires a `path` (the drug name) to work.
*   **`conditions`**: The patient's active medical diagnoses (e.g., "Diabetes", "Heart Failure", "Asthma").
*   **`allergies`**: A list of known sensitivities (e.g., "Penicillin", "Sulfa"). Use `contains` to prevent prescribing a drug the patient is allergic to.

---

## 4. COMPLETE JSON EXAMPLES
These examples show you exactly how to structure a full rule. You can copy these and change the drug names or values.

### 🏥 Example 1: Pregnancy Contraindication (Category X)
**Logic:** IF patient is **Pregnant** AND taking a **Dangerous Drug** (like Accutane).
```json
{
  "rule_name": "Pregnancy Category X Alert",
  "rule_condition": {
    "all": [
      { "fact": "is_pregnant", "operator": "==", "value": true },
      { "fact": "medications", "operator": "contains", "value": "isotretinoin" }
    ]
  },
  "rule_action": {
    "message": "CRITICAL: Accutane in Pregnancy",
    "recommendation": "Stop medication immediately. High risk of severe fetal birth defects.",
    "severity": "critical"
  }
}
```

### 🥛 Example 2: Lactation Safety Warning
**Logic:** IF patient is **Breastfeeding** AND taking **Metronidazole**.
```json
{
  "rule_condition": {
    "all": [
      { "fact": "is_lactating", "operator": "==", "value": true },
      { "fact": "medications", "operator": "contains", "value": "metronidazole" }
    ]
  },
  "rule_action": {
    "message": "Lactation Alert: Metronidazole",
    "recommendation": "Excreted in breast milk. Withhold breastfeeding for 12-24 hours after a large single dose.",
    "severity": "high"
  }
}
```

### 👴 Example 3: Geriatric Polypharmacy Alert
**Logic:** IF **Elderly (>65)** AND taking **More than 10 medications**.
```json
{
  "rule_name": "High Polypharmacy Alert",
  "rule_condition": {
    "all": [
      { "fact": "age", "operator": ">", "value": 65 },
      { "fact": "medication_count", "operator": ">", "value": 10 }
    ]
  },
  "rule_action": {
    "message": "High Medication Burden Detected",
    "recommendation": "Patient is taking {{medication_count}} meds. Review for unnecessary drugs and interaction risks.",
    "severity": "high"
  }
}
```

### 👶 Example 4: Pediatric Aspirin Safety (Reye's Syndrome)
**Logic:** IF **Age is under 18** AND taking **Aspirin**.
```json
{
  "rule_name": "Pediatric Aspirin Warning",
  "rule_condition": {
    "all": [
      { "fact": "age", "operator": "<", "value": 18 },
      { "fact": "medications", "operator": "contains", "value": "aspirin" }
    ]
  },
  "rule_action": {
    "message": "Pediatric Aspirin Risk",
    "recommendation": "Risk of Reye's Syndrome in children. Use Acetaminophen instead.",
    "severity": "critical"
  }
}
```

### 🧪 Example 5: Renal Adjustment (Lab + Drug + Any)
**Logic:** IF **Kidney function is low (<30)** AND (taking **Gentamicin** OR **Tobramycin**).
```json
{
  "rule_name": "Renal Dosing Adjustment",
  "rule_condition": {
    "all": [
      { "fact": "labs.egfr", "operator": "<", "value": 30 },
      {
        "any": [
          { "fact": "medications", "operator": "contains", "value": "gentamicin" },
          { "fact": "medications", "operator": "contains", "value": "tobramycin" }
        ]
      }
    ]
  },
  "rule_action": {
    "message": "Renal Dose Required",
    "recommendation": "eGFR is {{labs.egfr}}. Reduce dose of aminoglycosides to prevent toxicity.",
    "severity": "high"
  }
}
```

### ⚖️ Example 6: High Dose Warfarin Check
**Logic:** IF taking **Warfarin** AND **Dose is over 10mg**.
```json
{
  "rule_name": "High Dose Warfarin Alert",
  "rule_condition": {
    "all": [
      { "fact": "medications", "operator": "contains", "value": "warfarin" },
      {
        "fact": "medication_dose",
        "path": "warfarin",
        "operator": ">",
        "value": 10
      }
    ]
  },
  "rule_action": {
    "message": "Unusually High Warfarin Dose",
    "recommendation": "Dose is {{medication_dose}}mg. Verify INR and check for bleeding signs.",
    "severity": "high"
  }
}
```

### 💓 Example 7: Hyperkalemia Risk (Drug + Lab)
**Logic:** IF taking **Spironolactone** AND **Potassium is high (>5.0)**.
```json
{
  "rule_name": "Hyperkalemia Safety Warning",
  "rule_condition": {
    "all": [
      { "fact": "medications", "operator": "contains", "value": "spironolactone" },
      { "fact": "labs.potassium", "operator": ">", "value": 5.0 }
    ]
  },
  "rule_action": {
    "message": "High Potassium Risk",
    "recommendation": "Potassium is {{labs.potassium}}. Spironolactone increases potassium; consider dose reduction or monitoring.",
    "severity": "high"
  }
}
```

### 🩸 Example 8: Hepatic Safety Alert (Liver Labs)
**Logic:** IF **ALT is very high (>120)** AND taking **Acetaminophen**.
```json
{
  "rule_name": "Hepatic Injury Warning",
  "rule_condition": {
    "all": [
      { "fact": "labs.alt", "operator": ">", "value": 120 },
      { "fact": "medications", "operator": "contains", "value": "acetaminophen" }
    ]
  },
  "rule_action": {
    "message": "Hepatotoxicity Risk",
    "recommendation": "Elevated liver enzymes detected (ALT: {{labs.alt}}). Reduce or stop acetaminophen use.",
    "severity": "critical"
  }
}
```

### 🍬 Example 9: Uncontrolled Diabetes Check
**Logic:** IF **HbA1c is high (>9.0)** OR **Blood Sugar is high (>300)**.
```json
{
  "rule_name": "Severe Hyperglycemia Alert",
  "rule_condition": {
    "any": [
      { "fact": "labs.hba1c", "operator": ">", "value": 9.0 },
      { "fact": "labs.blood_sugar", "operator": ">", "value": 300 }
    ]
  },
  "rule_action": {
    "message": "Poor Glucose Control",
    "recommendation": " HbA1c/Sugar levels indicate severe lack of control. Review medication adherence and dose.",
    "severity": "high"
  }
}
```

### 🧠 Example 10: Anticholinergic Burden in Elderly (Multiple Drugs)
**Logic:** IF **Age > 65** AND (taking **Diphenhydramine** OR **Amitriptyline**).
```json
{
  "rule_name": "Elderly Beers Criteria Warning",
  "rule_condition": {
    "all": [
      { "fact": "age", "operator": ">", "value": 65 },
      {
        "any": [
          { "fact": "medications", "operator": "contains", "value": "diphenhydramine" },
          { "fact": "medications", "operator": "contains", "value": "amitriptyline" }
        ]
      }
    ]
  },
  "rule_action": {
    "message": "High CNS Side-Effect Risk",
    "recommendation": "These drugs increase risk of falls and confusion in elderly patients. Consider safer alternatives.",
    "severity": "moderate"
  }
}
```

### ⚡ Example 11: QT Prolongation Risk (Interaction)
**Logic:** IF taking **Amiodarone** AND taking **Azithromycin**.
```json
{
  "rule_name": "Torsades de Pointes Risk",
  "rule_condition": {
    "all": [
      { "fact": "medications", "operator": "contains", "value": "amiodarone" },
      { "fact": "medications", "operator": "contains", "value": "azithromycin" }
    ]
  },
  "rule_action": {
    "message": "QT Prolongation Risk",
    "recommendation": "Combination increases Risk of fatal arrhythmia. Monitor ECG and electrolytes.",
    "severity": "critical"
  }
}
```

### 🐚 Example 12: Hyponatremia Alert
**Logic:** IF **Sodium is critically low (<130)**.
```json
{
  "rule_name": "Critical Low Sodium Level",
  "rule_condition": {
    "all": [
      { "fact": "labs.sodium", "operator": "<", "value": 130 }
    ]
  },
  "rule_action": {
    "message": "Hyponatremia Alert",
    "recommendation": "Sodium level ({{labs.sodium}}) is dangerously low. Identify cause and monitor neurologically.",
    "severity": "critical"
  }
}
```

### 🦠 Example 13: Sepsis/Infection Warning (Vitals + Lab)
**Logic:** IF **Temperature > 38.5** AND **WBC > 15**.
```json
{
  "rule_name": "Infection Monitoring Alert",
  "rule_condition": {
    "all": [
      { "fact": "vitals.temperature", "operator": ">", "value": 38.5 },
      { "fact": "labs.wbc_count", "operator": ">", "value": 15 }
    ]
  },
  "rule_action": {
    "message": "High Fever & Leukocytosis",
    "recommendation": "Vitals and Labs correlate with acute infection. Monitor carefully.",
    "severity": "high"
  }
}
```

### 🛑 Example 14: Severe Hypertension Check
**Logic:** IF **Systolic BP > 180** OR **Diastolic BP > 110**.
```json
{
  "rule_name": "Hypertensive Crisis Alert",
  "rule_condition": {
    "any": [
      { "fact": "vitals.systolic", "operator": ">", "value": 180 },
      { "fact": "vitals.diastolic", "operator": ">", "value": 110 }
    ]
  },
  "rule_action": {
    "message": "Severe Hypertension: {{vitals.systolic}}/{{vitals.diastolic}}",
    "recommendation": "Patient is in hypertensive crisis range. Seek immediate medical intervention.",
    "severity": "critical"
  }
}
```

### 🩸 Example 15: Anemia Monitoring
**Logic:** IF **Hemoglobin < 10**.
```json
{
  "rule_name": "Anemia Alert",
  "rule_condition": {
    "all": [
      { "fact": "labs.hemoglobin", "operator": "<", "value": 10 }
    ]
  },
  "rule_action": {
    "message": "Low Hemoglobin Detected",
    "recommendation": "Hb level is {{labs.hemoglobin}}. Evaluate for iron deficiency or chronic causes.",
    "severity": "moderate"
  }
}
```

### 🚫 Example 16: Untreated Hypertension (Using `NOT` and `ANY`)
**Logic:** IF **Systolic BP > 140** AND patient is **NOT** taking **ANY** blood pressure medication.
```json
{
  "rule_name": "Untreated Hypertension Alert",
  "rule_condition": {
    "all": [
      { "fact": "vitals.systolic", "operator": ">", "value": 140 },
      {
        "not": {
          "any": [
            { "fact": "medications", "operator": "contains", "value": "lisinopril" },
            { "fact": "medications", "operator": "contains", "value": "amlodipine" },
            { "fact": "medications", "operator": "contains", "value": "losartan" },
            { "fact": "medications", "operator": "contains", "value": "hydrochlorothiazide" }
          ]
        }
      }
    ]
  },
  "rule_action": {
    "message": "Potential Untreated Hypertension",
    "recommendation": "Patient has high BP ({{vitals.systolic}}) but is not on common antihypertensives. Evaluate for therapy initiation.",
    "severity": "high"
  }
}
```

### 🛑 Example 17: Broad NSAID Contraindication (Using `ANY`)
**Logic:** IF patient has **Kidney Disease** AND is taking **ANY** medication from the NSAID list.
```json
{
  "rule_name": "NSAID Avoidance in Kidney Disease",
  "rule_condition": {
    "all": [
      { "fact": "conditions", "operator": "contains", "value": "kidney disease" },
      {
        "any": [
          { "fact": "medications", "operator": "contains", "value": "ibuprofen" },
          { "fact": "medications", "operator": "contains", "value": "naproxen" },
          { "fact": "medications", "operator": "contains", "value": "diclofenac" },
          { "fact": "medications", "operator": "contains", "value": "celecoxib" }
        ]
      }
    ]
  },
  "rule_action": {
    "message": "NSAID Use with Kidney Disease",
    "recommendation": "NSAIDs can worsen established kidney disease. Suggest switching to Acetaminophen for pain control.",
    "severity": "high"
  }
}
```

### 🧪 Example 18: Missing Lab Monitoring (Using `NOT`)
**Logic:** IF patient is taking **Warfarin** AND does **NOT** have a recorded **INR** lab result.
```json
{
  "rule_name": "Missing INR Lab Check",
  "rule_condition": {
    "all": [
      { "fact": "medications", "operator": "contains", "value": "warfarin" },
      {
        "not": {
          "fact": "labs.inr",
          "operator": "exists",
          "value": true
        }
      }
    ]
  },
  "rule_action": {
    "message": "Missing Warfarin Monitoring",
    "recommendation": "Patient is on Warfarin but no INR level is on file. Order an INR test to ensure safety.",
    "severity": "high"
  }
}
```
