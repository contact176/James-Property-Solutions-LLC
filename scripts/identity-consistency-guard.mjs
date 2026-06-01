#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const STRICT_MODE = process.argv.includes("--strict");

const EXPECTED = {
  businessName: "James Property Solutions LLC",
  visiblePhone: "(463) 324-9549",
  canonicalPhone: "+14633249549",
  mailto: "contact@jamespropertysolution.com",
  urls: [
    "https://jamespropertysolution.com/",
    "https://www.jamespropertysolution.com/",
  ],
};

const OLD_PHONE_PATTERNS = [
  /317-903-0991/g,
  /\(317\)\s*903-0991/g,
  /3179030991/g,
  /\+13179030991/g,
  /317\.903\.0991/g,
];

function extractTargets(html, scheme) {
  const rx = new RegExp(`href\\s*=\\s*["']${scheme}:([^"']+)["']`, "gi");
  const matches = [...html.matchAll(rx)].map((m) => m[1].trim());
  return matches.map((target) => target.split("?")[0]);
}

function extractCanonicalUrl(html) {
  const match = html.match(
    /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i
  );
  return match ? match[1].trim() : null;
}

function extractOgUrl(html) {
  const match = html.match(
    /<meta[^>]+property=["']og:url["'][^>]*content=["']([^"']+)["'][^>]*>/i
  );
  return match ? match[1].trim() : null;
}

function normalizeUrlForCompare(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const pathname = u.pathname || "/";
    const normalizedPath = pathname.endsWith("/") ? pathname : `${pathname}/`;
    return `${u.protocol}//${u.host}${normalizedPath}${u.search}${u.hash}`;
  } catch {
    return String(url).trim();
  }
}

function collectSignals(html) {
  const telTargets = extractTargets(html, "tel");
  const smsTargets = extractTargets(html, "sms");
  const mailtoTargets = extractTargets(html, "mailto").map((s) => s.toLowerCase());
  const canonicalUrl = extractCanonicalUrl(html);
  const ogUrl = extractOgUrl(html);

  const oldPhoneHits = OLD_PHONE_PATTERNS.map((pattern) => {
    const hits = html.match(pattern);
    return hits ? { pattern: String(pattern), count: hits.length } : null;
  }).filter(Boolean);

  const nonLlcNameHits = html.match(/James Property Solutions(?! LLC)/g) ?? [];

  return {
    hasBusinessName: html.includes(EXPECTED.businessName),
    hasVisiblePhone: html.includes(EXPECTED.visiblePhone),
    hasSchemaTelephone: new RegExp(`"telephone"\\s*:\\s*"\\${EXPECTED.canonicalPhone}"`).test(html),
    telTargets,
    smsTargets,
    mailtoTargets,
    canonicalUrl,
    ogUrl,
    oldPhoneHits,
    nonLlcNameHits: nonLlcNameHits.length,
  };
}

function unique(values) {
  return [...new Set(values)];
}

function validateSignals(label, signals) {
  const errors = [];

  if (!signals.hasBusinessName) {
    errors.push(`[${label}] Missing business name: "${EXPECTED.businessName}"`);
  }
  if (!signals.hasVisiblePhone) {
    errors.push(`[${label}] Missing visible phone: "${EXPECTED.visiblePhone}"`);
  }
  if (!signals.hasSchemaTelephone) {
    errors.push(
      `[${label}] Missing JSON-LD telephone: "${EXPECTED.canonicalPhone}"`
    );
  }
  if (signals.nonLlcNameHits > 0) {
    errors.push(
      `[${label}] Found ${signals.nonLlcNameHits} non-LLC business name occurrence(s): "James Property Solutions"`
    );
  }
  if (signals.oldPhoneHits.length > 0) {
    const detail = signals.oldPhoneHits
      .map((h) => `${h.pattern} x${h.count}`)
      .join(", ");
    errors.push(`[${label}] Found old phone value(s): ${detail}`);
  }

  if (signals.telTargets.length === 0) {
    errors.push(`[${label}] No tel: links found`);
  }
  for (const t of unique(signals.telTargets)) {
    if (t !== EXPECTED.canonicalPhone) {
      errors.push(`[${label}] Non-canonical tel: target found: "${t}"`);
    }
  }

  if (signals.smsTargets.length === 0) {
    errors.push(`[${label}] No sms: links found`);
  }
  for (const t of unique(signals.smsTargets)) {
    if (t !== EXPECTED.canonicalPhone) {
      errors.push(`[${label}] Non-canonical sms: target found: "${t}"`);
    }
  }

  if (signals.mailtoTargets.length === 0) {
    errors.push(`[${label}] No mailto: links found`);
  }
  for (const m of unique(signals.mailtoTargets)) {
    if (m !== EXPECTED.mailto) {
      errors.push(`[${label}] Unexpected mailto address found: "${m}"`);
    }
  }

  if (STRICT_MODE) {
    if (!signals.canonicalUrl) {
      errors.push(`[${label}] Missing canonical URL link`);
    }
    if (!signals.ogUrl) {
      errors.push(`[${label}] Missing og:url meta tag`);
    }
    const canonicalNormalized = normalizeUrlForCompare(signals.canonicalUrl);
    const ogNormalized = normalizeUrlForCompare(signals.ogUrl);
    if (canonicalNormalized && ogNormalized && canonicalNormalized !== ogNormalized) {
      errors.push(
        `[${label}] canonical/og:url mismatch: canonical="${signals.canonicalUrl}" og:url="${signals.ogUrl}"`
      );
    }
  }

  return errors;
}

function liveFingerprint(signals) {
  return JSON.stringify({
    businessName: signals.hasBusinessName,
    visiblePhone: signals.hasVisiblePhone,
    schemaTelephone: signals.hasSchemaTelephone,
    telTargets: unique(signals.telTargets).sort(),
    smsTargets: unique(signals.smsTargets).sort(),
    mailtoTargets: unique(signals.mailtoTargets).sort(),
  });
}

function isRedirectStatus(status) {
  return status >= 300 && status < 400;
}

function redirectChainSignature(chain) {
  return JSON.stringify(
    chain.map((hop) => ({
      status: hop.status,
      location: hop.location ? normalizeUrlForCompare(hop.location) : null,
    }))
  );
}

async function fetchLive(url) {
  if (!STRICT_MODE) {
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    const html = await response.text();
    return {
      html,
      finalStatus: response.status,
      finalUrl: response.url || url,
      redirectChain: [{ status: response.status, location: null }],
    };
  }

  const redirectChain = [];
  const maxRedirects = 10;
  let currentUrl = url;

  for (let i = 0; i <= maxRedirects; i += 1) {
    const response = await fetch(currentUrl, { redirect: "manual" });
    const status = response.status;
    const locationHeader = response.headers.get("location");
    const nextLocation = locationHeader
      ? new URL(locationHeader, currentUrl).toString()
      : null;

    redirectChain.push({
      status,
      location: nextLocation,
    });

    if (isRedirectStatus(status)) {
      if (!nextLocation) {
        throw new Error(`Redirect status ${status} without Location header`);
      }
      currentUrl = nextLocation;
      continue;
    }

    const html = await response.text();
    return {
      html,
      finalStatus: status,
      finalUrl: currentUrl,
      redirectChain,
    };
  }

  throw new Error(`Too many redirects (>${maxRedirects})`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchLiveWithRetry(url, attempts = 3) {
  let lastError = null;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await fetchLive(url);
    } catch (error) {
      lastError = error;
      if (i < attempts) {
        await delay(500 * i);
      }
    }
  }
  throw lastError;
}

async function main() {
  const errors = [];

  let localHtml = "";
  try {
    localHtml = await readFile("index.html", "utf8");
  } catch (error) {
    console.error(`Unable to read index.html: ${error.message}`);
    process.exit(1);
  }

  const localSignals = collectSignals(localHtml);
  errors.push(...validateSignals("local:index.html", localSignals));

  const liveResults = [];
  for (const url of EXPECTED.urls) {
    try {
      const live = await fetchLiveWithRetry(url);
      const signals = collectSignals(live.html);
      liveResults.push({ url, signals, live });
      errors.push(...validateSignals(`live:${url}`, signals));
      if (STRICT_MODE && live.finalStatus !== 200) {
        errors.push(
          `[live:${url}] Strict mode requires HTTP 200 final status, got ${live.finalStatus}`
        );
      }
    } catch (error) {
      errors.push(`[live:${url}] Fetch failed: ${error.message}`);
    }
  }

  if (liveResults.length === 2) {
    const [a, b] = liveResults;
    const fpA = liveFingerprint(a.signals);
    const fpB = liveFingerprint(b.signals);
    if (fpA !== fpB) {
      errors.push(
        `[live] Identity signal mismatch between domains: ${a.url} vs ${b.url}`
      );
      errors.push(`[live] ${a.url} fingerprint: ${fpA}`);
      errors.push(`[live] ${b.url} fingerprint: ${fpB}`);
    }

    if (STRICT_MODE) {
      const chainA = redirectChainSignature(a.live.redirectChain);
      const chainB = redirectChainSignature(b.live.redirectChain);
      if (chainA !== chainB) {
        errors.push(
          `[live] Redirect chain mismatch between domains: ${a.url} vs ${b.url}`
        );
        errors.push(`[live] ${a.url} redirect chain: ${chainA}`);
        errors.push(`[live] ${b.url} redirect chain: ${chainB}`);
      }
    }
  }

  if (errors.length > 0) {
    console.error("IDENTITY GUARD FAILED");
    for (const err of errors) {
      console.error(`- ${err}`);
    }
    process.exit(1);
  }

  console.log("IDENTITY GUARD PASSED");
  console.log(`- Business name: ${EXPECTED.businessName}`);
  console.log(`- Canonical phone: ${EXPECTED.canonicalPhone}`);
  console.log(`- Visible phone: ${EXPECTED.visiblePhone}`);
  console.log(`- Mailto: ${EXPECTED.mailto}`);
  console.log(`- Mode: ${STRICT_MODE ? "strict" : "default"}`);
  console.log(`- Checked local file: index.html`);
  console.log(`- Checked live URLs: ${EXPECTED.urls.join(", ")}`);
}

await main();
