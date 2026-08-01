import { config } from 'dotenv';
config();
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function test() {
    const { data: rules } = await supabase.from('clinical_rules').select('*').eq('is_active', true);
    
    const medName = 'rivaroxaban';
    const collectFacts = (node) => {
        if (!node) return [];
        const results = [];
        if (node.fact) results.push(node);
        if (Array.isArray(node.all)) node.all.forEach(child => results.push(...collectFacts(child)));
        if (Array.isArray(node.any)) node.any.forEach(child => results.push(...collectFacts(child)));
        return results;
    };
    
    const hasMedication = (condition) => {
        const facts = collectFacts(condition);
        return facts.some(f => f.fact === 'medications' && f.value && String(f.value).toLowerCase().includes(medName));
    };

    const major_interactions = [];
    rules.forEach(rule => {
        const cond = rule.rule_condition;
        if (!hasMedication(cond)) return;

        const allFacts = collectFacts(cond);
        const msg = rule.rule_action?.message_client || rule.rule_action?.message || rule.rule_name;
        
        console.log('Matched Rule:', rule.rule_name, '| Type:', rule.rule_type);

        if (rule.rule_type === 'drug_interaction' || String(rule.rule_name).toLowerCase().includes('interaction')) {
            let interactionBlocks = Array.isArray(rule.rule_condition?.any) ? rule.rule_condition.any : [rule.rule_condition];
            interactionBlocks.forEach(block => {
                const blockFacts = collectFacts(block);
                const involvesTargetMed = blockFacts.some(f => f.fact === 'medications' && f.value && String(f.value).toLowerCase().includes(medName));
                if (involvesTargetMed) {
                    const otherMedsInBlock = blockFacts.filter(f => f.fact === 'medications' && f.value && !String(f.value).toLowerCase().includes(medName));
                    otherMedsInBlock.forEach(i => {
                        major_interactions.push(i.value + ' — ' + msg);
                    });
                }
            });
        }
    });

    console.log('Interactions found:', major_interactions.length);
}
test();
