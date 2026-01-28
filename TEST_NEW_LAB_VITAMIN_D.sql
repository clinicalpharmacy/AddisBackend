-- ============================================
-- TEST CASE: Vitamin D Lab Test + CDSS Rule
-- ============================================
-- This script creates a new lab test and a corresponding CDSS rule
-- to test automatic integration with the RuleEngine

-- Step 1: Create the new lab test definition
INSERT INTO lab_tests (name, unit, reference_range, category, is_active, description)
VALUES (
    'Vitamin D',
    'ng/mL',
    '30-100',
    'Vitamin Panel',
    true,
    'Vitamin D (25-hydroxyvitamin D) blood level - important for bone health and immune function'
)
ON CONFLICT (name) DO UPDATE 
SET 
    unit = EXCLUDED.unit,
    reference_range = EXCLUDED.reference_range,
    category = EXCLUDED.category,
    is_active = EXCLUDED.is_active,
    description = EXCLUDED.description;

-- Step 2: Create a CDSS rule for low Vitamin D
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
    'Low Vitamin D Alert',
    'lab_monitoring',
    'Alert when Vitamin D levels are below the normal range indicating deficiency',
    '{
        "all": [
            {
                "fact": "labs.vitamin_d",
                "operator": "<",
                "value": 30
            }
        ]
    }'::jsonb,
    '{
        "message": "Low Vitamin D Detected ({{labs.vitamin_d}} ng/mL)",
        "recommendation": "Vitamin D level is below 30 ng/mL, indicating deficiency. Consider supplementation with Vitamin D3 (cholecalciferol) 1000-2000 IU daily. Recheck levels in 3 months. Evaluate for risk factors: limited sun exposure, malabsorption, chronic kidney disease.",
        "severity": "moderate"
    }'::jsonb,
    'moderate',
    'monitoring_needed',
    true,
    ARRAY['all_patients'],
    NOW(),
    NOW()
)
ON CONFLICT (rule_name) DO UPDATE 
SET 
    rule_condition = EXCLUDED.rule_condition,
    rule_action = EXCLUDED.rule_action,
    severity = EXCLUDED.severity,
    is_active = EXCLUDED.is_active,
    updated_at = NOW();

-- Step 3: Verify the lab test was created
SELECT 
    name,
    unit,
    reference_range,
    category,
    is_active,
    description
FROM lab_tests
WHERE name = 'Vitamin D';

-- Step 4: Verify the rule was created
SELECT 
    rule_name,
    rule_type,
    severity,
    rule_condition,
    rule_action,
    is_active
FROM clinical_rules
WHERE rule_name = 'Low Vitamin D Alert';

-- ============================================
-- EXPECTED RESULTS:
-- ============================================
-- 1. Lab test "Vitamin D" should appear in Lab Settings
-- 2. Lab test should appear in patient Labs tab under "Vitamin Panel"
-- 3. When you enter a value < 30 (e.g., 25), the CDSS alert should trigger
-- 4. Alert message: "Low Vitamin D Detected (25 ng/mL)"
-- ============================================

-- ============================================
-- TEST INSTRUCTIONS:
-- ============================================
-- 1. Run this SQL script in Supabase SQL Editor
-- 2. Go to your app → Patients → Select or create a patient
-- 3. Navigate to Labs tab
-- 4. Find "Vitamin D (ng/mL)" under "Vitamin Panel"
-- 5. Enter value: 25
-- 6. Wait 1 second
-- 7. You should see a YELLOW/ORANGE alert box appear at the top
-- ============================================
