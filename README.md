# @cronlabs/core

The cron engine that powers [CronLabs](https://cronlabs.dev). It parses and
validates cron expressions, computes upcoming run times, explains schedules in
plain English, detects the edge cases that cause real outages (daylight saving
skips and double-fires, phantom schedules, frequency surprises), and converts a
standard cron expression into other platform dialects.

It is written in TypeScript with no I/O, so it runs the same way in the browser,
in edge functions, in a CLI, and on a server.

## Install

```bash
npm install @cronlabs/core
```

Node.js 18 or newer is required. The package ships as ES modules with type
definitions.

## Validate an expression

`validateCron` returns whether the expression is valid, its next run times, a
plain-English description, and any detected edge cases.

```ts
import { validateCron } from "@cronlabs/core";

const result = validateCron("30 2 * * *", {
  timezone: "America/New_York",
  count: 5,
});

result.isValid;     // true
result.description; // "At 02:30 AM"
result.nextRuns;    // Date[] (the next 5 run times)
result.edgeCases;   // structured findings, including DST skips for 02:30
```

`validateCron` accepts these options:

- `timezone`: an IANA timezone used to compute run times. Defaults to `"UTC"`.
- `count`: how many upcoming runs to return. Defaults to `10`.
- `year`: the reference year used when scanning for edge cases. Defaults to the
  current year.

The result includes a `warnings` array of human-readable strings and an
`edgeCases` array of structured findings. Each edge case has a `kind`
(`"phantom"`, `"rare"`, `"frequency"`, `"dom-dow-or"`, `"dst-skip"`, or
`"dst-double"`), a `severity` (`"info"` or `"warning"`), and a `message`.

## Describe and inspect

```ts
import { describeCron, parseCronFields } from "@cronlabs/core";

describeCron("0 9 * * 1-5"); // "At 09:00 AM, Monday through Friday"

parseCronFields("0 9 * * 1-5");
// [{ name: "Minute", value: "0", description: "0-59" }, ...]
```

## Convert to other platforms

`convertCron` translates a standard five-field expression into the dialect and
native configuration of another platform. `convertAll` returns the conversion
for every supported target.

```ts
import { convertCron, convertAll, CONVERSION_TARGETS } from "@cronlabs/core";

const aws = convertCron("0 9 * * 1-5", "aws-eventbridge");
aws.schedule; // "cron(0 9 ? * 2-6 *)"
aws.snippet;  // a ready-to-use AWS CLI command
aws.notes;    // platform gotchas for this expression

convertAll("0 9 * * 1-5"); // one Conversion per target in CONVERSION_TARGETS
```

Supported targets (`CONVERSION_TARGETS`):

- `unix-cron` (crontab, Vixie/cronie)
- `github-actions`
- `vercel`
- `kubernetes`
- `aws-eventbridge`
- `gcp-scheduler`
- `systemd`
- `quartz` (Quartz and Spring)
- `node-cron`
- `celery`

Each conversion reports platform gotchas as `notes`. Examples include the AWS
and Quartz day-of-week reindexing to 1-7 with 1 as Sunday, the rule that one of
day-of-month or day-of-week must be `?` on those platforms, the UTC-only
behaviour of GitHub Actions schedules, and the Vercel Hobby plan limits.

## Daylight saving transitions

`getDstTransitions` returns the spring-forward and fall-back dates for a
timezone in a given year. This is what lets a calendar view flag the days where
a wall-clock schedule can skip or fire twice.

```ts
import { getDstTransitions } from "@cronlabs/core";

getDstTransitions(2026, "America/New_York");
// [{ day: 8, month: 3, type: "spring-forward" }, { day: 1, month: 11, type: "fall-back" }]
```

## License

MIT
