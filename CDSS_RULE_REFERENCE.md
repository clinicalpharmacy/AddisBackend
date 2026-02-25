# CLINICAL DECISION SUPPORT SYSTEM - COMPLETE RULE CONDITIONS REFERENCE

## BASIC RULE CONDITION STRUCTURE
Rules are defined using a logic-based JSON structure. You can combine multiple conditions using `all` (AND), `any` (OR), or `not` (NOT).

```json
{
  "all": [
    // ALL conditions must be true (AND logic)
  ],
  "any": [
    // ANY condition can be true (OR logic)  
  ]
}
```

---

## 1. PATIENT DEMOGRAPHICS
Use these facts to target specific patient populations.

| Fact | Operator | Example Value | Description |
| :--- | :--- | :--- | :--- |
| `age` | `>`, `<`, `==` | `65` | Patient age in years |
| `age_in_days` | `<=`, `>=` | `28` | Specifically for neonates and infants |
| `gender` | `==` | `"Female"` | Case-insensitive |
| `is_pregnant` | `==` | `true` | Boolean check |
| `pregnancy_weeks` | `>`, `<` | `28` | Weeks of gestation |
| `is_lactating` | `==` | `true` | Breastfeeding status |
| `weight` | `>`, `<` | `70` | In kg |
| `bmi` | `>`, `<` | `30` | Body Mass Index |

---

## 2. LABS & VITALS
Access lab values using the `labs.` prefix and vitals using `vitals.`.

### Common Lab Facts:
*   `labs.creatinine` (mg/dL)
*   `labs.egfr` (mL/min/1.73m²)
*   `labs.potassium` (mmol/L)
*   `labs.hemoglobin` (g/dL)
*   `labs.wbc_count` (10³/µL)
*   `labs.platelet_count` (10³/µL)
*   `labs.hba1c` (%)
*   `labs.alt` / `labs.ast` (U/L)
*   `labs.inr`

### Common Vital Facts:
*   `vitals.systolic` / `vitals.diastolic`
*   `vitals.heart_rate`
*   `vitals.temperature`
*   `vitals.oxygen_saturation`

---

## 3. MEDICATIONS & CONDITIONS
Check for current medications or medical history.

| Fact | Operator | Description |
| :--- | :--- | :--- |
| `medications` | `contains` | Checks if a drug (generic/brand) is in the current list |
| `medication_count` | `>`, `<` | Count of total active medications |
| `conditions` | `contains` | Checks medical history/diagnoses |
| `allergies` | `contains` | Checks if patient is allergic to a substance |

---

## 4. COMPLETE RULE EXAMPLES

### Example: Pregnancy + Contraindicated Drug
```json
{
  "rule_name": "Pregnancy Category X Warning",
  "rule_condition": {
    "all": [
      { "fact": "is_pregnant", "operator": "equals", "value": true },
      { "fact": "medications", "operator": "contains", "value": "warfarin" }
    ]
  },
  "rule_action": {
    "message": "CRITICAL: Warfarin in Pregnancy",
    "recommendation": "Warfarin is contraindicated. Switch to LMWH if anticoagulation is required.",
    "severity": "critical"
  }
}
```

### Example: Renal Adjustment (Lab + Drug)
```json
{
  "rule_name": "Renal Dose Adjustment - Gentamicin",
  "rule_condition": {
    "all": [
      { "fact": "labs.egfr", "operator": "<", "value": 30 },
      { "fact": "medications", "operator": "contains", "value": "gentamicin" }
    ]
  },
  "rule_action": {
    "message": "Dose Adjustment Required",
    "recommendation": "eGFR is <30. Reduce Gentamicin dose and monitor serum levels.",
    "severity": "high"
  }
}
```

### Example: Geriatric Polypharmacy
```json
{
  "rule_name": "Geriatric Polypharmacy Review",
  "rule_condition": {
    "all": [
      { "fact": "age", "operator": ">", "value": 65 },
      { "fact": "medication_count", "operator": ">", "value": 10 }
    ]
  },
  "rule_action": {
    "message": "High Medication Burden",
    "recommendation": "Patient is taking {{medication_count}} medications. Review for deprescribing opportunities.",
    "severity": "moderate"
  }
}
```

---

## AVAILABLE OPERATORS
*   `==`, `!=`: Equality
*   `>`, `<`, `>=`, `<=`: Numerical comparison
*   `contains`: String search in an array (for medications, allergies, conditions)
*   `exists`: Checks if a value is present
*   `not_contains`: Array does not include the value
