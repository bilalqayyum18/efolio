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
  hasResume: false, // set true when resume.pdf is added
} as const;

export const projects = [
  {
    slug: "safarwise",
    title: "SafarWise",
    subtitle: "AI-powered visa intelligence for Pakistani travelers",
    problem: "Pakistani travelers face fragmented visa and document guidance across dozens of sources.",
    outcome: "Production platform — 42 pages, 64 DB migrations, live at safarwise.app",
    tags: ["Next.js 15", "FastAPI", "Supabase", "Gemini AI", "Systems Design"],
    liveUrl: "https://safarwise.app",
    repoUrl: "https://github.com/bilalqayyum18/travelbuddy-web-app",
    metric: "236M+ visa queries served",
  },
  {
    slug: "kababish",
    title: "Kababish Restaurant",
    subtitle: "Production Android ordering platform",
    problem: "Restaurant needed end-to-end ordering and kitchen operations in one native app.",
    outcome: "v3.0.4 on Play Store — realtime orders, loyalty, admin dashboard",
    tags: ["Kotlin", "Jetpack Compose", "Supabase Realtime", "Firebase FCM", "MVVM"],
    liveUrl: "https://play.google.com/store/apps/details?id=com.kababish.restaurant",
    metric: "Realtime order sync",
  },
  {
    slug: "aviation",
    title: "Pakistan Aviation Analytics",
    subtitle: "20 years of CAA traffic data",
    problem: "Two decades of government aviation data trapped in a single Excel workbook.",
    outcome: "~300M passengers, ~5.4M tonnes cargo — interactive BI dashboard",
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
