-- ============================================
-- TEST CASE 2: Magnesium Lab Test + CDSS Rule
-- ============================================
-- Another test case with a different mineral

-- Step 1: Create the new lab test definition
INSERT INTO lab_tests (name, unit, reference_range, category, is_active, description)
VALUES (
    'Serum Magnesium',
    'mg/dL',
    '1.7-2.2',
    'Electrolytes',
    true,
    'Serum magnesium level - important for muscle and nerve function, heart rhythm, and bone health'
)
ON CONFLICT (name) DO UPDATE 
SET 
    unit = EXCLUDED.unit,
    reference_range = EXCLUDED.reference_range,
    category = EXCLUDED.category,
    is_active = EXCLUDED.is_active,
    description = EXCLUDED.description;

-- Step 2: Create a CDSS rule for low Magnesium
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
    'Low Magnesium Alert',
    'lab_monitoring',
    'Alert when serum magnesium levels are below normal range',
    '{
        "all": [
            {
                "fact": "labs.serum_magnesium",
                "operator": "<",
                "value": 1.7
            }
        ]
    }'::jsonb,
    '{
        "message": "Low Magnesium Detected ({{labs.serum_magnesium}} mg/dL)",
        "recommendation": "Serum magnesium is below 1.7 mg/dL. Hypomagnesemia can cause muscle cramps, cardiac arrhythmias, and seizures. Consider oral magnesium supplementation or IV magnesium if severe. Check for causes: diuretics, GI losses, alcohol use.",
        "severity": "high"
    }'::jsonb,
    'high',
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

-- Step 3: Create a CDSS rule for HIGH Magnesium
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
    'High Magnesium Alert',
    'lab_monitoring',
    'Alert when serum magnesium levels are above normal range',
    '{
        "all": [
            {
                "fact": "labs.serum_magnesium",
                "operator": ">",
                "value": 2.2
            }
        ]
    }'::jsonb,
    '{
        "message": "Elevated Magnesium Detected ({{labs.serum_magnesium}} mg/dL)",
        "recommendation": "Serum magnesium is above 2.2 mg/dL. Hypermagnesemia can cause muscle weakness, hypotension, and respiratory depression. Check for causes: renal failure, excessive supplementation, or antacids. Monitor closely.",
        "severity": "high"
    }'::jsonb,
    'high',
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

-- Verify
SELECT name, unit, reference_range, category FROM lab_tests WHERE name = 'Serum Magnesium';
SELECT rule_name, severity, is_active FROM clinical_rules WHERE rule_name LIKE '%Magnesium%';

-- ============================================
-- TEST INSTRUCTIONS:
-- ============================================
-- 1. Run this SQL script
-- 2. Go to patient Labs tab
-- 3. Find "Serum Magnesium (mg/dL)" under "Electrolytes"
-- 4. Test LOW: Enter 1.5 → Should trigger "Low Magnesium Alert"
-- 5. Test HIGH: Enter 2.5 → Should trigger "High Magnesium Alert"
-- 6. Test NORMAL: Enter 2.0 → Should NOT trigger any alert
-- ============================================
