import { splitFields, type CronParts } from "./fields.js";

/**
 * Universal cron converter. Translates a standard 5-field Unix/Vixie cron
 * expression into the dialect and native config of other scheduling platforms,
 * surfacing the per-platform gotchas that silently change behaviour (UTC-only
 * schedulers, 6-field formats, the day-of-month/day-of-week `?` rule, plan
 * limits, and so on). Pure functions — no I/O.
 *
 * Input is assumed to be a valid 5-field expression (minute hour dom month dow).
 */

export type ConversionTargetId =
  | "unix-cron"
  | "github-actions"
  | "vercel"
  | "kubernetes"
  | "aws-eventbridge"
  | "gcp-scheduler"
  | "systemd"
  | "quartz"
  | "node-cron"
  | "celery";

export type ConversionFormat =
  | "cron"
  | "yaml"
  | "json"
  | "bash"
  | "python"
  | "javascript"
  | "java"
  | "ini";

export interface ConversionTarget {
  id: ConversionTargetId;
  /** Display name, e.g. "GitHub Actions". */
  name: string;
  category:
    | "Scheduler"
    | "CI/CD"
    | "Serverless"
    | "Containers"
    | "Cloud"
    | "System"
    | "Library";
  /** Official docs for the platform's schedule syntax. */
  docsUrl: string;
}

export interface ConversionNote {
  severity: "info" | "warning" | "error";
  message: string;
}

export interface Conversion {
  target: ConversionTarget;
  /** Platform-native schedule string (may differ from the input — e.g. AWS is 6-field). */
  schedule: string;
  /** Copy-pasteable snippet in the platform's native config format. */
  snippet: string;
  format: ConversionFormat;
  /** Gotchas relevant to this specific expression on this platform. */
  notes: ConversionNote[];
}

export interface ConvertOptions {
  /** Timezone the schedule is intended for. Defaults to "UTC". */
  timezone?: string;
  /** The command, URL, or path the schedule should trigger (used in snippets). */
  command?: string;
  /** A name for the generated job/resource. */
  name?: string;
}

/** Registry of every supported conversion target, in display order. */
export const CONVERSION_TARGETS: readonly ConversionTarget[] = [
  { id: "unix-cron", name: "crontab (Unix/Vixie)", category: "Scheduler", docsUrl: "https://man7.org/linux/man-pages/man5/crontab.5.html" },
  { id: "github-actions", name: "GitHub Actions", category: "CI/CD", docsUrl: "https://docs.github.com/actions/using-workflows/events-that-trigger-workflows#schedule" },
  { id: "vercel", name: "Vercel Cron", category: "Serverless", docsUrl: "https://vercel.com/docs/cron-jobs" },
  { id: "kubernetes", name: "Kubernetes CronJob", category: "Containers", docsUrl: "https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/" },
  { id: "aws-eventbridge", name: "AWS EventBridge", category: "Cloud", docsUrl: "https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-scheduled-rule-pattern.html" },
  { id: "gcp-scheduler", name: "GCP Cloud Scheduler", category: "Cloud", docsUrl: "https://cloud.google.com/scheduler/docs/configuring/cron-job-schedules" },
  { id: "systemd", name: "systemd timer", category: "System", docsUrl: "https://www.freedesktop.org/software/systemd/man/systemd.time.html" },
  { id: "quartz", name: "Quartz / Spring", category: "Library", docsUrl: "https://www.quartz-scheduler.org/documentation/quartz-2.3.0/tutorials/crontrigger.html" },
  { id: "node-cron", name: "node-cron", category: "Library", docsUrl: "https://github.com/node-cron/node-cron" },
  { id: "celery", name: "Celery", category: "Library", docsUrl: "https://docs.celeryq.dev/en/stable/userguide/periodic-tasks.html#crontab-schedules" },
];

const TARGET_BY_ID = new Map(CONVERSION_TARGETS.map((t) => [t.id, t]));

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------

const DOW_NAMES: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};
// systemd uses three-letter English names, Monday-first.
const SYSTEMD_DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Map one day-of-week token (number 0-7 or name) to 0-6, or null if unknown. */
function dowTokenToNum(token: string): number | null {
  if (/^\d+$/.test(token)) {
    const n = Number(token);
    return n >= 0 && n <= 7 ? n % 7 : null;
  }
  const named = DOW_NAMES[token.toLowerCase()];
  return named === undefined ? null : named;
}

/**
 * Expand a day-of-week field into the explicit set of weekdays (0=Sun..6=Sat)
 * it matches. Returns null when the field uses features we can't safely remap
 * (Quartz/AWS extensions `L`, `W`, `#`).
 */
export function expandDayOfWeek(field: string): number[] | null {
  if (field === "*" || field === "?") return [0, 1, 2, 3, 4, 5, 6];
  if (/[LW#]/i.test(field)) return null;

  const days = new Set<number>();
  for (const token of field.split(",")) {
    const match = token.match(/^(\*|[a-z]{3}|\d+)(?:-([a-z]{3}|\d+))?(?:\/(\d+))?$/i);
    if (!match) return null;
    const [, startRaw, endRaw, stepRaw] = match;
    const step = stepRaw ? Number(stepRaw) : 1;
    if (step < 1) return null;

    let lo: number;
    let hi: number;
    if (startRaw === "*") {
      lo = 0;
      hi = 6;
    } else {
      const s = dowTokenToNum(startRaw!);
      if (s === null) return null;
      lo = s;
      if (endRaw) {
        const e = dowTokenToNum(endRaw);
        if (e === null) return null;
        hi = e;
      } else {
        hi = s;
      }
    }

    // Support wrap-around ranges (e.g. Fri-Mon = 5-1).
    if (hi < lo) {
      for (let n = lo; n <= 6; n += step) days.add(n % 7);
      for (let n = 0; n <= hi; n += step) days.add(n % 7);
    } else {
      for (let n = lo; n <= hi; n += step) days.add(n % 7);
    }
  }
  return [...days].sort((a, b) => a - b);
}

/** Compress a set of integers into a compact cron list, collapsing runs to ranges. */
export function compressRanges(values: number[]): string {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  if (sorted.length === 0) return "*";

  const parts: string[] = [];
  let start = sorted[0]!;
  let prev = sorted[0]!;
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i]!;
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = prev = n;
  }
  parts.push(start === prev ? `${start}` : `${start}-${prev}`);
  return parts.join(",");
}

/**
 * Re-encode a standard day-of-week field (0-6, 0=Sun) into one-based numbering
 * (1-7, 1=Sun) used by AWS EventBridge and Quartz. Returns null if the field
 * can't be expanded (caller should pass it through and warn).
 */
function dayOfWeekToOneBased(field: string): string | null {
  const days = expandDayOfWeek(field);
  if (!days) return null;
  return compressRanges(days.map((n) => (n % 7) + 1));
}

interface QmResult {
  dom: string;
  dow: string;
  /** True when both day fields were restricted — unsupported by AWS/Quartz. */
  bothRestricted: boolean;
}

/**
 * Apply the AWS/Quartz rule: you can't specify both day-of-month and
 * day-of-week — one must be `?`. `dowConverted` is the already-reindexed dow.
 */
function resolveQuestionMark(
  dom: string,
  dowOriginal: string,
  dowConverted: string,
): QmResult {
  const domStar = dom === "*";
  const dowStar = dowOriginal === "*" || dowOriginal === "?";

  if (domStar && dowStar) return { dom: "*", dow: "?", bothRestricted: false };
  if (!domStar && dowStar) return { dom, dow: "?", bothRestricted: false };
  if (domStar && !dowStar) return { dom: "?", dow: dowConverted, bothRestricted: false };
  // Both restricted: AWS/Quartz can't OR them like Vixie cron. Keep day-of-month.
  return { dom, dow: "?", bothRestricted: true };
}

const hasMultiple = (field: string) => /[*,/-]/.test(field);
const isFixedInt = (field: string) => /^\d+$/.test(field);

/** Roughly: does this fire more than once per day? (minute & hour not both fixed) */
function firesSubDaily(parts: CronParts): boolean {
  return !(isFixedInt(parts.minute) && isFixedInt(parts.hour));
}

/** Smallest minute interval implied by the minute field, or null if not a simple step. */
function minuteStep(minuteField: string): number | null {
  if (minuteField === "*") return 1;
  const stepMatch = minuteField.match(/^\*\/(\d+)$/);
  if (stepMatch) return Number(stepMatch[1]);
  return null;
}

const canonical = (parts: CronParts) =>
  `${parts.minute} ${parts.hour} ${parts.dayOfMonth} ${parts.month} ${parts.dayOfWeek}`;

// ---------------------------------------------------------------------------
// systemd OnCalendar conversion
// ---------------------------------------------------------------------------

/** Convert a single cron field to its OnCalendar equivalent. */
function calField(field: string): string {
  if (field === "*") return "*";
  if (/^\d+$/.test(field)) return field.padStart(2, "0");
  const step = field.match(/^\*\/(\d+)$/);
  if (step) return `0/${step[1]}`;
  return field; // ranges/lists pass through; caller flags as approximate
}

/** Compress day numbers into systemd weekday names, collapsing runs with "..". */
function toSystemdDays(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const runs: Array<[number, number]> = [];
  let start = sorted[0]!;
  let prev = sorted[0]!;
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i]!;
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    runs.push([start, prev]);
    start = prev = n;
  }
  runs.push([start, prev]);
  return runs
    .map(([s, e]) => (s === e ? SYSTEMD_DOW[s] : `${SYSTEMD_DOW[s]}..${SYSTEMD_DOW[e]}`))
    .join(",");
}

function toOnCalendar(parts: CronParts): { value: string; approximate: boolean } {
  let approximate = false;

  let dowPart = "";
  if (parts.dayOfWeek !== "*" && parts.dayOfWeek !== "?") {
    const days = expandDayOfWeek(parts.dayOfWeek);
    if (days) dowPart = `${toSystemdDays(days)} `;
    else approximate = true;
  }

  const month = parts.month === "*" ? "*" : calField(parts.month);
  const dom = parts.dayOfMonth === "*" ? "*" : calField(parts.dayOfMonth);
  const time = `${calField(parts.hour)}:${calField(parts.minute)}:00`;

  // Lists don't translate to a single OnCalendar token.
  if (/,/.test(`${parts.minute}${parts.hour}${parts.dayOfMonth}${parts.month}`)) {
    approximate = true;
  }

  return { value: `${dowPart}*-${month}-${dom} ${time}`, approximate };
}

// ---------------------------------------------------------------------------
// Per-target builders
// ---------------------------------------------------------------------------

interface BuildCtx {
  timezone: string;
  command: string;
  name: string;
}

type Builder = (parts: CronParts, ctx: BuildCtx) => Omit<Conversion, "target">;

/** Shared AWS/Quartz path: reindex day-of-week and apply the `?` rule. */
function buildSixFieldDayFields(parts: CronParts, platform: string) {
  const notes: ConversionNote[] = [];
  let dowConverted = parts.dayOfWeek;

  if (parts.dayOfWeek !== "*" && parts.dayOfWeek !== "?") {
    const mapped = dayOfWeekToOneBased(parts.dayOfWeek);
    if (mapped) {
      dowConverted = mapped;
      notes.push({
        severity: "warning",
        message: `${platform} numbers days-of-week 1-7, where 1=Sunday. The day-of-week field was reindexed from the standard 0-6 numbering automatically.`,
      });
    } else {
      notes.push({
        severity: "warning",
        message: `Couldn't auto-convert the day-of-week field. ${platform} uses 1-7 (1=Sunday). Verify it manually.`,
      });
    }
  }

  const { dom, dow, bothRestricted } = resolveQuestionMark(
    parts.dayOfMonth,
    parts.dayOfWeek,
    dowConverted,
  );

  if (bothRestricted) {
    notes.push({
      severity: "error",
      message: `${platform} can't match both day-of-month AND day-of-week. Converted to day-of-month only. Split into two schedules if you need both.`,
    });
  } else {
    notes.push({
      severity: "info",
      message: `${platform} requires '?' in one day field; it was placed in ${dom === "?" ? "day-of-month" : "day-of-week"}.`,
    });
  }

  return { dom, dow, notes };
}

const BUILDERS: Record<ConversionTargetId, Builder> = {
  "unix-cron": (parts, ctx) => {
    const schedule = canonical(parts);
    const notes: ConversionNote[] = [
      { severity: "info", message: "Day-of-week accepts 0 or 7 for Sunday." },
    ];
    let snippet = `# ┌ min ┌ hour ┌ day-of-month ┌ month ┌ day-of-week\n${schedule} ${ctx.command}`;
    if (ctx.timezone !== "UTC") {
      notes.push({
        severity: "warning",
        message: `cron uses the system timezone. For ${ctx.timezone}, set CRON_TZ at the top of the crontab so DST transitions are handled correctly.`,
      });
      snippet = `CRON_TZ=${ctx.timezone}\n${schedule} ${ctx.command}`;
    }
    return { schedule, snippet, format: "cron", notes };
  },

  "github-actions": (parts, ctx) => {
    const schedule = canonical(parts);
    const notes: ConversionNote[] = [
      {
        severity: "info",
        message: "Scheduled workflows always run in UTC and can be delayed during periods of high load.",
      },
    ];
    if (ctx.timezone !== "UTC") {
      notes.push({
        severity: "warning",
        message: `GitHub Actions ignores timezones. Convert your ${ctx.timezone} times to UTC before using this schedule.`,
      });
    }
    const step = minuteStep(parts.minute);
    if (step !== null && step < 5) {
      notes.push({
        severity: "warning",
        message: "GitHub Actions runs scheduled jobs at most every 5 minutes; finer intervals are coalesced.",
      });
    }
    const snippet = `name: ${ctx.name}\non:\n  schedule:\n    - cron: "${schedule}"\njobs:\n  run:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ${ctx.command}`;
    return { schedule, snippet, format: "yaml", notes };
  },

  vercel: (parts, ctx) => {
    const schedule = canonical(parts);
    const path = ctx.command.startsWith("/") ? ctx.command : "/api/cron";
    const notes: ConversionNote[] = [
      { severity: "info", message: "Vercel evaluates cron schedules in UTC." },
    ];
    if (firesSubDaily(parts)) {
      notes.push({
        severity: "warning",
        message: "Vercel Hobby allows only once-per-day schedules (and at most 2 cron jobs). This fires more often and requires a Pro plan.",
      });
    } else if (isFixedInt(parts.minute) && parts.minute !== "0") {
      notes.push({
        severity: "info",
        message: "On Hobby, daily crons fire at some point within the scheduled hour. The exact minute is approximate.",
      });
    }
    const snippet = `{\n  "crons": [\n    {\n      "path": "${path}",\n      "schedule": "${schedule}"\n    }\n  ]\n}`;
    return { schedule, snippet, format: "json", notes };
  },

  kubernetes: (parts, ctx) => {
    const schedule = canonical(parts);
    const notes: ConversionNote[] = [
      {
        severity: "info",
        message: "Set spec.timeZone to pin a zone (Kubernetes ≥ 1.27); otherwise the controller-manager's timezone is used.",
      },
    ];
    const tzLine = ctx.timezone !== "UTC" ? `\n  timeZone: ${ctx.timezone}` : "";
    const snippet = `apiVersion: batch/v1\nkind: CronJob\nmetadata:\n  name: ${ctx.name}\nspec:\n  schedule: "${schedule}"${tzLine}\n  jobTemplate:\n    spec:\n      template:\n        spec:\n          containers:\n            - name: ${ctx.name}\n              image: busybox:latest\n              command: ["/bin/sh", "-c", "${ctx.command}"]\n          restartPolicy: OnFailure`;
    return { schedule, snippet, format: "yaml", notes };
  },

  "aws-eventbridge": (parts, ctx) => {
    const { dom, dow, notes } = buildSixFieldDayFields(parts, "AWS");
    const schedule = `cron(${parts.minute} ${parts.hour} ${dom} ${parts.month} ${dow} *)`;
    notes.push({
      severity: "info",
      message: "AWS cron is 6-field with a trailing year. EventBridge Scheduler supports a timezone; classic Events rules are UTC-only.",
    });
    const snippet = `aws scheduler create-schedule \\\n  --name ${ctx.name} \\\n  --schedule-expression "${schedule}" \\\n  --schedule-expression-timezone "${ctx.timezone}" \\\n  --flexible-time-window '{"Mode":"OFF"}' \\\n  --target '{"Arn":"<TARGET_ARN>","RoleArn":"<ROLE_ARN>"}'`;
    return { schedule, snippet, format: "bash", notes };
  },

  "gcp-scheduler": (parts, ctx) => {
    const schedule = canonical(parts);
    const notes: ConversionNote[] = [
      {
        severity: "info",
        message: "Cloud Scheduler uses standard unix cron and defaults to UTC unless --time-zone is set.",
      },
      {
        severity: "info",
        message: "App Engine's legacy cron.yaml uses a different English-like syntax (e.g. 'every 2 hours').",
      },
    ];
    const uri = ctx.command.startsWith("http") ? ctx.command : "https://example.com/cron";
    const snippet = `gcloud scheduler jobs create http ${ctx.name} \\\n  --schedule="${schedule}" \\\n  --time-zone="${ctx.timezone}" \\\n  --uri="${uri}" \\\n  --http-method=POST`;
    return { schedule, snippet, format: "bash", notes };
  },

  systemd: (parts, ctx) => {
    const { value, approximate } = toOnCalendar(parts);
    const notes: ConversionNote[] = [
      {
        severity: "info",
        message: "systemd uses OnCalendar (DayOfWeek Year-Month-Day Hour:Minute:Second), a different grammar from cron.",
      },
    ];
    if (approximate) {
      notes.push({
        severity: "warning",
        message: "This expression uses lists/ranges that don't map 1:1 to OnCalendar. Verify with: systemd-analyze calendar '<value>'.",
      });
    }
    const snippet = `# /etc/systemd/system/${ctx.name}.timer\n[Unit]\nDescription=${ctx.name}\n\n[Timer]\nOnCalendar=${value}\nPersistent=true\n\n[Install]\nWantedBy=timers.target`;
    return { schedule: value, snippet, format: "ini", notes };
  },

  quartz: (parts, ctx) => {
    const { dom, dow, notes } = buildSixFieldDayFields(parts, "Quartz");
    const schedule = `0 ${parts.minute} ${parts.hour} ${dom} ${parts.month} ${dow}`;
    notes.push({
      severity: "info",
      message: "Quartz is 6-field with a leading seconds field (set to 0) and numbers days-of-week 1-7 (1=Sunday).",
    });
    notes.push({
      severity: "warning",
      message: "Spring's @Scheduled uses a different dialect. It numbers day-of-week 0-7 (0/7=Sunday) and allows '*' in both day fields. Use the Spring line below for Spring.",
    });
    const snippet = `// Quartz CronTrigger\nCronScheduleBuilder.cronSchedule("${schedule}");\n\n// Spring @Scheduled (different day-of-week numbering)\n@Scheduled(cron = "0 ${parts.minute} ${parts.hour} ${parts.dayOfMonth} ${parts.month} ${parts.dayOfWeek}", zone = "${ctx.timezone}")`;
    return { schedule, snippet, format: "java", notes };
  },

  "node-cron": (parts, ctx) => {
    const schedule = canonical(parts);
    const notes: ConversionNote[] = [
      { severity: "info", message: "node-cron also accepts an optional 6th leading seconds field." },
    ];
    const tz = ctx.timezone !== "UTC" ? `, { timezone: "${ctx.timezone}" }` : "";
    const snippet = `import cron from "node-cron";\n\ncron.schedule("${schedule}", () => {\n  // ${ctx.command}\n}${tz});`;
    return { schedule, snippet, format: "javascript", notes };
  },

  celery: (parts, ctx) => {
    const schedule = canonical(parts);
    const notes: ConversionNote[] = [
      {
        severity: "info",
        message: "Celery schedules use crontab() keyword arguments instead of a single cron string. Day-of-week is 0-6 (0=Sunday) or names, the same as standard cron.",
      },
    ];
    void ctx;
    const snippet = `from celery.schedules import crontab\n\ncrontab(\n    minute="${parts.minute}",\n    hour="${parts.hour}",\n    day_of_month="${parts.dayOfMonth}",\n    month_of_year="${parts.month}",\n    day_of_week="${parts.dayOfWeek}",\n)`;
    return { schedule, snippet, format: "python", notes };
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Convert a 5-field cron expression to a single target platform. */
export function convertCron(
  expression: string,
  target: ConversionTargetId,
  options: ConvertOptions = {},
): Conversion {
  const meta = TARGET_BY_ID.get(target);
  if (!meta) throw new Error(`Unknown conversion target: ${target}`);

  const parts = splitFields(expression);
  const ctx: BuildCtx = {
    timezone: options.timezone ?? "UTC",
    command: options.command ?? "/path/to/job",
    name: options.name ?? "my-job",
  };
  return { target: meta, ...BUILDERS[target](parts, ctx) };
}

/** Convert a 5-field cron expression to every supported target. */
export function convertAll(
  expression: string,
  options: ConvertOptions = {},
): Conversion[] {
  return CONVERSION_TARGETS.map((t) => convertCron(expression, t.id, options));
}
