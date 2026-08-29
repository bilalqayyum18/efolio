export const site = {
  name: "Bilal Qayyum",
  title: "Data Analyst · Business Analyst · Systems Analyst",
  tagline:
    "I turn complex operational data into decisions — and build the systems that deliver them.",
  url: "https://devpak.ovh",
  email: "bqk2015@gmail.com",
  emailSecondary: "bilal@safarwise.app",
  linkedin: "https://www.linkedin.com/in/bilal-qayyum-khan-703a44145",
  github: "https://github.com/bilalqayyum18",
  resumePath: "/assets/resume.pdf",
  hasResume: false,
} as const;

export const projects = [
  {
    slug: "safarwise",
    title: "SafarWise",
    subtitle: "AI-powered visa intelligence for Pakistani travelers",
    problem: "Pakistani travelers face fragmented visa and document guidance across dozens of conflicting sources.",
    outcome:
      "Smart automated visa research system with layered QA — 300+ published guides, full admin operations suite, live at safarwise.app",
    tags: ["Next.js 15", "FastAPI", "Supabase", "Gemini AI", "Systems Design"],
    liveUrl: "https://safarwise.app",
    repoUrl: "https://github.com/bilalqayyum18/travelbuddy-web-app",
    metric: "300+ Visa Guides Generated",
  },
  {
    slug: "kababish",
    title: "Kababish Restaurant",
    subtitle: "Production Android ordering platform",
    problem: "A live restaurant needed one native app for customer ordering and back-of-house operations — not separate tools.",
    outcome:
      "End-to-end Android app on Play Store — ordering, tracking, loyalty, push notifications, and a full admin command centre",
    tags: ["Kotlin", "Jetpack Compose", "Supabase Realtime", "Firebase FCM", "MVVM"],
    liveUrl: "https://play.google.com/store/apps/details?id=com.kababish.restaurant",
    metric: "Realtime order sync",
  },
  {
    slug: "aviation",
    title: "Pakistan Aviation Analytics",
    subtitle: "20 years of CAA traffic data",
    problem:
      "Pakistan CAA releases yearly aviation statistics as unstructured PDFs — difficult to search, compare, or analyse across two decades.",
    outcome:
      "Pakistan's most comprehensive public aviation data dashboard — two decades of traffic data, exclusively interactive here",
    tags: ["Python ETL", "DuckDB-WASM", "Recharts", "KPI Design"],
    liveUrl: "/projects/aviation",
    metric: "173K+ flight legs analysed",
  },
] as const;

export const skills = {
  data: ["Python", "Pandas", "Excel", "SQL", "ETL Pipelines", "KPI Design", "DuckDB", "Recharts"],
  business: ["CASE Analysis", "Requirements Traceability", "Stakeholder Mapping", "Process Modelling", "MoSCoW"],
  systems: ["Next.js", "FastAPI", "Supabase", "Kotlin", "System Design", "API Design", "CI/CD"],
} as const;
