/**
 * Pre-baked IC question packs. Analyst picks one, and the runner fires each
 * question through the existing streaming ask endpoint one-at-a-time — prompt
 * caching means calls 2..N share the same doc cache and run much faster than
 * the first.
 *
 * Hard-coded for now. Later: move to the DB so deal teams can author their own.
 */

export type QuestionPack = {
  key: string;
  title: string;
  description: string;
  questions: string[];
};

export const PACKS: QuestionPack[] = [
  {
    key: "revenue-quality",
    title: "Revenue quality",
    description:
      "Breaks down how the business earns, how predictable it is, and where it's growing.",
    questions: [
      "What was revenue for the most recent fiscal year and the prior two years? Show growth rates.",
      "What's the LTM revenue, and how does it compare to the most recent full fiscal year?",
      "What percentage of revenue is recurring vs. one-time, and how is 'recurring' defined?",
      "Is revenue seasonal or cyclical? If so, describe the pattern.",
      "How is revenue broken down by product, service line, or segment?",
      "What's the net revenue retention / gross revenue retention, if disclosed?",
      "Are there any revenue-recognition policies that materially affect the reported numbers?",
      "What are the key growth drivers management cites, and how credible are they based on the documents?"
    ]
  },
  {
    key: "customer-concentration",
    title: "Customer concentration",
    description: "How dependent is the business on a small number of customers?",
    questions: [
      "Who are the top 10 customers by revenue, with contribution percentages if available?",
      "What percentage of revenue comes from the top 1, 5, and 10 customers?",
      "What's the tenure of the top 5 customers with the company?",
      "Are there any contracts with the top customers disclosed? What are the notable terms (length, termination, exclusivity)?",
      "Has the company lost any material customers in the last 3 years?",
      "What's the customer churn rate or logo retention, if disclosed?"
    ]
  },
  {
    key: "management-team",
    title: "Management team",
    description: "Who runs the company and are they the right team to execute the plan?",
    questions: [
      "Who are the key executives (CEO, CFO, COO, and other C-suite)? List their names and titles.",
      "For each key executive: how long have they been with the company, and what's their prior experience?",
      "Are there any disclosed executive compensation details, including equity?",
      "What roles are currently open or planned to be hired?",
      "Is there a disclosed succession plan?",
      "Have there been any executive departures in the last 2 years?"
    ]
  },
  {
    key: "market-competition",
    title: "Market & competition",
    description: "Size the market, identify the competitive set, and assess differentiation.",
    questions: [
      "What is the total addressable market (TAM) as presented in the documents? How is it defined?",
      "Who are the main competitors identified in the materials?",
      "How does the company differentiate from its competitors, according to the documents?",
      "What's the company's market share or positioning, if disclosed?",
      "What market tailwinds or headwinds does management cite?",
      "Are there regulatory, technology, or customer-behavior trends that favor or threaten the business?"
    ]
  },
  {
    key: "unit-economics",
    title: "Unit economics",
    description: "Gross margin, CAC/LTV, and the economic engine behind the P&L.",
    questions: [
      "What are the gross margin trends over the last 3 years, by segment if available?",
      "What's the EBITDA or adjusted EBITDA margin, and how are adjustments defined?",
      "What's the customer acquisition cost (CAC) and lifetime value (LTV), if disclosed?",
      "What's the pricing structure, and has pricing changed meaningfully over time?",
      "How do unit economics compare across segments or customer cohorts?",
      "What's the disclosed payback period on customer acquisition?"
    ]
  },
  {
    key: "risks-red-flags",
    title: "Risks & red flags",
    description: "Pull every risk factor, legal issue, or concern flagged in the materials.",
    questions: [
      "What are the top risks the documents explicitly call out?",
      "Are there any pending or threatened lawsuits, regulatory actions, or investigations disclosed?",
      "Are there any material customer disputes, supplier issues, or channel conflicts mentioned?",
      "Has the company ever restated financials or had auditor issues?",
      "Are there any key-person risks (e.g., critical employee, customer-relationship owner)?",
      "Are there IP or data-security issues disclosed (breaches, IP challenges, open-source exposure)?",
      "Do the documents disagree with themselves anywhere on material facts? If so, where?"
    ]
  }
];

export function getPack(key: string): QuestionPack | undefined {
  return PACKS.find((p) => p.key === key);
}
