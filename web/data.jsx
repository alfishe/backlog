// TEST-ONLY seed data for the Personal Backlog prototype.
// Not loaded by default — only included when running in test/demo mode.
// To activate: uncomment the data.jsx <script> tag in index.html.
// When loaded, exposes window.SEED_DATA; the app detects it and shows a
// "Load sample data" button in the Tweaks panel.
//
// Realistic personal-project material: side projects, household, learning.
// Statuses: open, in-progress, blocked, postponed, done, cancelled
// Priorities: P0, P1, P2, P3
// Up to 4 levels: Area → Project → Task → Sub-task

const SEED_DATA = {
  entries: [
    {
      id: "area-side",
      level: 1,
      title: "Side projects",
      priority: "P1",
      status: "in-progress", progress: 50,
      due: null,
      tags: [],
      reason: null,
      collapsed: false,
      children: [
        {
          id: "proj-backlog",
          level: 2,
          title: "Personal backlog app",
          priority: "P0",
          status: "in-progress", progress: 65,
          due: "2026-05-12",
          tags: ["build", "tooling"],
          reason: null,
          collapsed: false,
          children: [
            {
              id: "t-parser",
              level: 3,
              title: "Markdown parser + integrity marker",
              priority: "P0",
              status: "done", progress: 100,
              due: "2026-04-28",
              tags: ["build"],
              reason: null,
              collapsed: false,
              children: [
                { id: "st-tokenize", level: 4, title: "Tokenize three sections", priority: "P0", status: "done", progress: 100, due: null, tags: [], reason: null, children: [] },
                { id: "st-checksum", level: 4, title: "SHA-256 over entries+history", priority: "P0", status: "done", progress: 100, due: null, tags: [], reason: null, children: [] }
              ]
            },
            {
              id: "t-renderer",
              level: 3,
              title: "Tree renderer with parent-visibility filter",
              priority: "P0",
              status: "in-progress", progress: 55,
              due: "2026-05-04",
              tags: ["build", "ui"],
              reason: null,
              collapsed: false,
              children: [
                { id: "st-collapse", level: 4, title: "Expand / collapse animations", priority: "P1", status: "open", progress: 25, due: null, tags: ["ui"], reason: null, children: [] },
                { id: "st-dnd", level: 4, title: "Drag handle within priority group", priority: "P1", status: "open", progress: 0, due: "2026-05-06", tags: ["ui"], reason: null, children: [] }
              ]
            },
            {
              id: "t-fsapi",
              level: 3,
              title: "File System Access API direct mode",
              priority: "P1",
              status: "blocked", progress: 50,
              due: "2026-05-10",
              tags: ["research"],
              reason: "Need to test on Edge — no machine yet",
              children: []
            },
            {
              id: "t-admin",
              level: 3,
              title: "Admin page — backup browser + restore",
              priority: "P2",
              status: "open", progress: 0,
              due: "2026-05-20",
              tags: ["build", "ui"],
              reason: null,
              children: []
            },
            {
              id: "t-stats",
              level: 3,
              title: "stats.jsonl rollups (90-day retention)",
              priority: "P3",
              status: "postponed", progress: 25,
              due: null,
              tags: ["build"],
              reason: null,
              children: []
            }
          ]
        },
        {
          id: "proj-cookbook",
          level: 2,
          title: "Family cookbook static site",
          priority: "P2",
          status: "in-progress", progress: 30,
          due: "2026-06-15",
          tags: ["writing"],
          reason: null,
          collapsed: true,
          children: [
            { id: "t-recipes", level: 3, title: "Transcribe Mom's index cards", priority: "P1", status: "in-progress", progress: 75, due: "2026-05-30", tags: ["writing"], reason: null, children: [] },
            { id: "t-photos", level: 3, title: "Photograph each finished dish", priority: "P2", status: "open", progress: 0, due: null, tags: ["photo"], reason: null, children: [] },
            { id: "t-print", level: 3, title: "Test print layout (8.5×11)", priority: "P3", status: "open", progress: 0, due: null, tags: [], reason: null, children: [] }
          ]
        }
      ]
    },
    {
      id: "area-house",
      level: 1,
      title: "Home & life admin",
      priority: "P1",
      status: "in-progress", progress: 50,
      due: null,
      tags: [],
      reason: null,
      collapsed: false,
      children: [
        {
          id: "proj-tax",
          level: 2,
          title: "File 2025 taxes",
          priority: "P0",
          status: "in-progress", progress: 50,
          due: "2026-04-15",
          tags: ["urgent", "finance"],
          reason: null,
          collapsed: false,
          children: [
            { id: "t-w2", level: 3, title: "Gather W-2s and 1099s", priority: "P0", status: "done", progress: 100, due: "2026-03-10", tags: ["finance"], reason: null, children: [] },
            { id: "t-deduct", level: 3, title: "Itemize charitable deductions", priority: "P0", status: "in-progress", progress: 50, due: "2026-04-10", tags: ["finance"], reason: null, children: [] },
            { id: "t-cpa", level: 3, title: "Schedule call with CPA", priority: "P0", status: "blocked", progress: 25, due: "2026-04-12", tags: ["urgent"], reason: "CPA out until Apr 8", children: [] }
          ]
        },
        {
          id: "proj-house",
          level: 2,
          title: "Apartment maintenance",
          priority: "P2",
          status: "in-progress", progress: 50,
          due: null,
          tags: [],
          reason: null,
          collapsed: false,
          children: [
            { id: "t-filter", level: 3, title: "Replace HVAC filter", priority: "P1", status: "open", progress: 0, due: "2026-05-05", tags: ["recurring"], reason: null, children: [] },
            { id: "t-sink", level: 3, title: "Fix leaky kitchen sink", priority: "P2", status: "open", progress: 0, due: null, tags: [], reason: null, children: [] },
            { id: "t-storage", level: 3, title: "Donate boxes from closet", priority: "P3", status: "postponed", progress: 25, due: null, tags: [], reason: null, children: [] }
          ]
        }
      ]
    },
    {
      id: "area-learn",
      level: 1,
      title: "Learning",
      priority: "P2",
      status: "in-progress", progress: 50,
      due: null,
      tags: [],
      reason: null,
      collapsed: false,
      children: [
        {
          id: "proj-rust",
          level: 2,
          title: "Rust in 30 days",
          priority: "P2",
          status: "in-progress", progress: 40,
          due: "2026-07-01",
          tags: ["learning", "rust"],
          reason: null,
          collapsed: true,
          children: [
            { id: "t-book", level: 3, title: "Read chapters 1–6", priority: "P2", status: "done", progress: 100, due: "2026-04-20", tags: ["rust"], reason: null, children: [] },
            { id: "t-cli", level: 3, title: "Build a small CLI tool", priority: "P2", status: "open", progress: 0, due: "2026-06-01", tags: ["rust"], reason: null, children: [] }
          ]
        },
        {
          id: "proj-piano",
          level: 2,
          title: "Pick piano back up",
          priority: "P3",
          status: "cancelled", progress: 0,
          due: null,
          tags: [],
          reason: null,
          collapsed: true,
          children: []
        }
      ]
    },
    {
      // standalone task at level 2 (no children)
      id: "oneoff-passport",
      level: 2,
      title: "Renew passport",
      priority: "P1",
      status: "open", progress: 0,
      due: "2026-05-15",
      tags: ["urgent"],
      reason: null,
      children: []
    }
  ],

  history: [
    { timestamp: "2026-05-01T08:12:30Z", itemId: "t-deduct", action: "status_changed", details: "open → in-progress" },
    { timestamp: "2026-04-30T19:44:02Z", itemId: "t-cpa", action: "status_changed", details: "open → blocked (CPA out until Apr 8)" },
    { timestamp: "2026-04-30T14:08:55Z", itemId: "t-renderer", action: "status_changed", details: "open → in-progress" },
    { timestamp: "2026-04-29T22:01:11Z", itemId: "st-checksum", action: "status_changed", details: "in-progress → done" },
    { timestamp: "2026-04-29T18:30:00Z", itemId: "t-parser", action: "status_changed", details: "in-progress → done" },
    { timestamp: "2026-04-28T09:15:42Z", itemId: "t-book", action: "status_changed", details: "in-progress → done" },
    { timestamp: "2026-04-27T11:22:18Z", itemId: "proj-piano", action: "status_changed", details: "postponed → cancelled" },
    { timestamp: "2026-04-25T13:50:09Z", itemId: "oneoff-passport", action: "item_created", details: "Renew passport" },
    { timestamp: "2026-04-24T07:33:50Z", itemId: "t-w2", action: "status_changed", details: "in-progress → done" },
    { timestamp: "2026-04-22T16:18:27Z", itemId: "t-recipes", action: "status_changed", details: "open → in-progress" },
    { timestamp: "2026-04-20T10:00:00Z", itemId: "proj-backlog", action: "item_created", details: "Personal backlog app" }
  ],

  meta: {
    saved: "2026-05-01T08:12:30Z",
    checksum: "sha256:9f2c4a1b6e88d7f0a3c5b2e9d1f7a4c8b6e2d5f1a9c7b3e0d8f2a5c1b4e7d3f9",
    entryCount: 27,
    historyCount: 1284
  },

  backups: [
    { name: "backlog_2026-05-01_08-12-30.md", size: 18432, timestamp: "2026-05-01T08:12:30Z", entries: 27, valid: true },
    { name: "backlog_2026-04-30_19-44-02.md", size: 18380, timestamp: "2026-04-30T19:44:02Z", entries: 27, valid: true },
    { name: "backlog_2026-04-30_14-08-55.md", size: 18290, timestamp: "2026-04-30T14:08:55Z", entries: 27, valid: true },
    { name: "backlog_2026-04-29_22-01-11.md", size: 18102, timestamp: "2026-04-29T22:01:11Z", entries: 26, valid: true },
    { name: "backlog_2026-04-29_18-30-00.md", size: 18044, timestamp: "2026-04-29T18:30:00Z", entries: 26, valid: true },
    { name: "backlog_2026-04-28_09-15-42.md", size: 17988, timestamp: "2026-04-28T09:15:42Z", entries: 26, valid: true },
    { name: "backlog_2026-04-27_11-22-18.md", size: 17920, timestamp: "2026-04-27T11:22:18Z", entries: 26, valid: true },
    { name: "backlog_2026-04-25_13-50-09.md", size: 17812, timestamp: "2026-04-25T13:50:09Z", entries: 25, valid: false },
    { name: "backlog_2026-04-22_16-18-27.md", size: 17640, timestamp: "2026-04-22T16:18:27Z", entries: 24, valid: true }
  ],

  health: {
    integrityOk: true,
    lastSave: "2026-05-01T08:12:30Z",
    lastBackup: "2026-05-01T08:12:30Z",
    masterSize: 18432,
    backupDirSize: 162608,
    backupCount: 9,
    statsSize: 48210,
    historySize: 84320,
    historyOldest: "2025-11-14T09:02:11Z",
    mode: "API server"
  },

  stats: {
    createdThisWeek: 6,
    completedThisWeek: 4,
    avgInProgressDays: 2.4,
    mostActiveProject: "Personal backlog app",
    completionByDay: [
      { day: "Mon", count: 1 },
      { day: "Tue", count: 0 },
      { day: "Wed", count: 2 },
      { day: "Thu", count: 1 },
      { day: "Fri", count: 0 },
      { day: "Sat", count: 0 },
      { day: "Sun", count: 0 }
    ],
    statusMix: { open: 9, "in-progress": 6, blocked: 2, postponed: 2, done: 7, cancelled: 1 }
  }
};

// --- Inflate seed with a realistic-sized tag vocabulary, so the autocomplete
// has hundreds of entries to search through (mirrors a power-user backlog).
(function inflateTags() {
  const POOL = [
    // domains
    "frontend","backend","infra","devops","mobile","ios","android","desktop","cli","web","api","sdk",
    // languages / stacks
    "js","ts","python","rust","go","sql","postgres","sqlite","redis","docker","k8s","aws","gcp","linux","macos","windows",
    // work types
    "research","spike","prototype","design","qa","testing","ci","release","launch","onboarding","docs","writing","talk","meeting",
    // life
    "home","family","kids","cooking","recipes","photo","garden","travel","car","health","fitness","reading","music","piano","guitar",
    // finance / admin
    "finance","tax","budget","invoice","insurance","subscription","passport","dmv","banking",
    // priority signals
    "urgent","quick-win","blocked-on-vendor","followup","waiting","external",
    // affinity tags
    "energy-low","deep-work","errand","weekend","evening","morning",
    // specifics
    "v2","v3","p0-week","oncall","review","rfc","interview","hiring","1-1","retro","planning","roadmap","sprint","standup"
  ];
  // Gather all leaf+branch items
  const all = [];
  (function walk(arr) { for (const it of arr) { all.push(it); if (it.children) walk(it.children); } })(SEED_DATA.entries);
  let seed = 1;
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (const it of all) {
    const existing = new Set(it.tags || []);
    const n = 1 + Math.floor(rand() * 3); // 1–3 extra tags
    for (let i = 0; i < n; i++) {
      const t = POOL[Math.floor(rand() * POOL.length)];
      existing.add(t);
    }
    it.tags = [...existing];
  }
})();

window.SEED_DATA = SEED_DATA;
