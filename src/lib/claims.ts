/**
 * Claims check for product wording.
 *
 * Products whose name, description or usage text promise medical, sexual-health, weight-loss, fertility,
 * financial or supernatural outcomes can't be published until the owner reviews the wording and approves it
 * with a note (e.g. the product's regulatory registration, or a decision to describe it as a traditional
 * product only). This is a guard rail, not legal advice: herbal products sold with medicinal claims may need
 * Pharmacy and Poisons Board registration in Kenya, and advertising rules apply.
 */

type Rule = { group: string; label: string; re: RegExp };

const RULES: Rule[] = [
  { group: "medical", label: "treatment or cure claim", re: /\b(cure[sd]?|curing|treat(s|ment|ing)?|heal(s|ing)?|remed(y|ies)|tiba|kutibu|inatibu|dawa ya|ponya|kuponya|prevents? disease)\b/i },
  { group: "medical", label: "named disease", re: /\b(cancer|diabet\w*|hiv|aids|malaria|hypertension|blood pressure|pressure ya damu|kisukari|ulcers?|typhoid|infection|arthritis|asthma|covid)\b/i },
  { group: "medical", label: "heart or digestion health claim", re: /\b(healthy heart|heart health|cholesterol|digestion|immunity|immune system|detox)\b/i },
  { group: "sexual", label: "sexual performance claim", re: /\b(sexual (power|performance|appetite)|libido|erection|nguvu za kiume|kuongeza nguvu|stamina|aphrodisiac|renew sexual)\b/i },
  { group: "fertility", label: "fertility or pregnancy claim", re: /\b(fertility|infertil\w*|pregnan\w*|mimba|uzazi|kizazi|conceive)\b/i },
  { group: "weight", label: "weight-loss claim", re: /\b(lo+se weight|weight loss|slim(ming)?|fat burn\w*|kupunguza (uzito|unene|tumbo)|burn fat)\b/i },
  { group: "financial", label: "money or business-success promise", re: /\b(fast cash|money oil|attract(s)? (money|wealth|customers)|wealth|utajiri|riches|boost sales|increase sales|massive sale|mvuto wa biashara|financial (success|prosperity))\b/i },
  { group: "relationship", label: "relationship or attraction promise", re: /\b(bring back (your )?(lover|partner)|love spell|make (him|her) (love|stay)|limbwata|mapenzi yarudi|mvuto wa mapenzi)\b/i },
  { group: "supernatural", label: "supernatural claim", re: /\b(witchcraft|uchawi|kichawi|majini|jini|spirits?|curse|spell|bad luck|nuksi|mikosi|evil eye|protection from (evil|witchcraft)|kufungua vifungo)\b/i },
  { group: "guarantee", label: "guarantee or absolute claim", re: /\b(guarantee(d)?|100% (effective|results?|guaranteed)|works? instantly|instant results?|no side effects|miracle)\b/i },
];

export type ClaimFlag = { group: string; label: string; match: string; field: string };

export function checkClaims(fields: Record<string, string | null | undefined>): ClaimFlag[] {
  const flags: ClaimFlag[] = [];
  for (const [field, text] of Object.entries(fields)) {
    if (!text) continue;
    for (const r of RULES) {
      const m = r.re.exec(text);
      if (m) flags.push({ group: r.group, label: r.label, match: m[0], field });
    }
  }
  return flags;
}

export const STANDARD_DISCLAIMERS: Record<string, string> = {
  TRADITIONAL_SPIRITUAL:
    "Sold as a traditional and cultural product. We make no promise of any medical, financial, relationship or other outcome.",
  HERBAL_CONSUMABLE:
    "This product is not intended to diagnose, treat, cure or prevent any disease. Speak to a qualified health professional before use, especially if you are pregnant, breastfeeding, taking medication or have a medical condition.",
  INCENSE_FRAGRANCE: "Burn in a ventilated space, away from children, pets and flammable materials. Never leave burning incense unattended.",
  COSMETIC: "For external use only. Do a patch test before first use and stop if irritation occurs.",
};
