/**
 * Environment Configuration Drift Detector
 * 
 * Compares configuration categories across development, staging, and production
 * environments without exposing secrets.
 * 
 * ## Usage
 * 
 * Run locally:
 *   node scripts/env-drift.mjs
 * 
 * Run with specific environment:
 *   node scripts/env-drift.mjs --env=staging
 * 
 * Output formats:
 *   node scripts/env-drift.mjs --format=json  # JSON output for CI
 *   node scripts/env-drift.mjs --format=table # Table output (default)
 * 
 * ## Output
 * 
 * - Report identifies missing or unexpectedly different settings
 * - Secret values remain redacted
 * - Divergences include owner and resolution guidance
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = join(__dirname, '..', 'config', 'environments');

// Secrets that should never be exposed in output
const SECRET_PATTERNS = [
  /key/i,
  /secret/i,
  /password/i,
  /token/i,
  /credential/i,
  /private/i,
  /api_key/i,
  /apikey/i,
];

// Environment categories for grouping
const ENV_CATEGORIES = {
  development: ['development', 'dev', 'local'],
  staging: ['staging', 'stage'],
  production: ['production', 'prod'],
};

// Default owners for configuration areas
const CONFIG_OWNERS = {
  'NEXT_PUBLIC_ORACLE_CONTRACT_ID': '@blockchain-team',
  'NEXT_PUBLIC_PROVENANCE_CONTRACT_ID': '@blockchain-team',
  'NEXT_PUBLIC_REGISTRY_CONTRACT_ID': '@blockchain-team',
  'NEXT_PUBLIC_API_URL': '@platform-team',
  'NEXT_PUBLIC_RPC_URL': '@infrastructure-team',
  'NEXT_PUBLIC_NETWORK': '@blockchain-team',
  'NEXT_PUBLIC_MOCK_WALLET': '@testing-team',
  'NODE_ENV': '@platform-team',
};

/**
 * Redact secret values from output
 */
function redactValue(key, value) {
  const isSecret = SECRET_PATTERNS.some(pattern => pattern.test(key));
  if (isSecret && value && typeof value === 'string') {
    return value.substring(0, 4) + '****';
  }
  return value;
}

/**
 * Load environment configuration
 */
function loadEnvConfig(envName) {
  const configPath = join(CONFIG_DIR, `${envName}.json`);
  
  if (!existsSync(configPath)) {
    throw new Error(`Configuration not found: ${envName}`);
  }
  
  return JSON.parse(readFileSync(configPath, 'utf-8'));
}

/**
 * Extract expected config keys and their values
 */
function extractExpectedConfig(config) {
  const expected = config.expected || {};
  const required = config.required || [];
  const forbidden = config.forbidden || {};
  
  return {
    expected,
    required,
    forbidden,
    // Include required keys with null to detect missing values
    requiredMap: Object.fromEntries(required.map(k => [k, null])),
  };
}

/**
 * Compare two environment configurations
 */
function compareConfigs(base, compare, baseName, compareName) {
  const differences = {
    missing: [],
    unexpected: [],
    different: [],
    forbidden_violation: [],
  };
  
  const allKeys = new Set([
    ...Object.keys(base.expected || {}),
    ...Object.keys(compare.expected || {}),
    ...base.required || [],
    ...compare.required || [],
  ]);
  
  for (const key of allKeys) {
    const baseValue = base.expected?.[key];
    const compareValue = compare.expected?.[key];
    const baseRequired = base.required?.includes(key);
    const compareRequired = compare.required?.includes(key);
    const forbiddenValues = compare.forbidden?.[key];
    
    // Check for missing in base but present in compare
    if (baseValue === undefined && compareValue !== undefined) {
      differences.unexpected.push({
        key,
        compareValue: redactValue(key, compareValue),
        category: categorizeKey(key),
      });
    }
    
    // Check for missing in compare but present in base
    if (baseValue !== undefined && compareValue === undefined) {
      differences.missing.push({
        key,
        baseValue: redactValue(key, baseValue),
        category: categorizeKey(key),
        isRequired: compareRequired,
      });
    }
    
    // Check for different values
    if (baseValue !== undefined && compareValue !== undefined && baseValue !== compareValue) {
      // Check if this difference is forbidden
      if (forbiddenValues && forbiddenValues.includes(compareValue)) {
        differences.forbidden_violation.push({
          key,
          baseValue: redactValue(key, baseValue),
          compareValue: redactValue(key, compareValue),
          forbiddenValues,
          category: categorizeKey(key),
        });
      } else {
        differences.different.push({
          key,
          baseValue: redactValue(key, baseValue),
          compareValue: redactValue(key, compareValue),
          category: categorizeKey(key),
          isIntentional: isIntentionalDifference(key, baseValue, compareValue),
        });
      }
    }
    
    // Check required keys
    if (compareRequired && compareValue === undefined) {
      differences.missing.push({
        key,
        category: categorizeKey(key),
        isRequired: true,
        severity: 'error',
      });
    }
  }
  
  return differences;
}

/**
 * Categorize a config key
 */
function categorizeKey(key) {
  if (key.startsWith('NEXT_PUBLIC_')) {
    const area = key.replace('NEXT_PUBLIC_', '').toLowerCase();
    if (area.includes('network') || area.includes('rpc') || area.includes('contract')) {
      return 'blockchain';
    }
    if (area.includes('api') || area.includes('url')) {
      return 'networking';
    }
    if (area.includes('mock') || area.includes('test')) {
      return 'testing';
    }
    return 'general';
  }
  return 'runtime';
}

/**
 * Determine if a difference is intentional (known override)
 */
function isIntentionalDifference(key, baseValue, compareValue) {
  // Known intentional differences
  const intentionalDiffs = {
    'NODE_ENV': true, // Different per environment by design
    'NEXT_PUBLIC_APP_ENV': true,
    'NEXT_PUBLIC_NETWORK': key.includes('NETWORK'), // network differs by env
  };
  
  return intentionalDiffs[key] || false;
}

/**
 * Get owner for a configuration key
 */
function getOwner(key) {
  return CONFIG_OWNERS[key] || '@platform-team';
}

/**
 * Get resolution guidance for a difference
 */
function getResolutionGuidance(diff, baseEnv, compareEnv) {
  const guidance = [];
  
  if (diff.isRequired) {
    guidance.push(`ACTION REQUIRED: Add ${diff.key} to ${compareEnv} environment`);
    guidance.push(`OWNER: ${getOwner(diff.key)}`);
    guidance.push(`RESOLUTION: Set value in ${compareEnv} deployment config`);
  }
  
  if (diff.isIntentional) {
    guidance.push(`INTENTIONAL: Difference is expected for ${compareEnv} environment`);
  }
  
  if (diff.forbiddenValues) {
    guidance.push(`VIOLATION: ${diff.key} has forbidden value(s): ${diff.forbiddenValues.join(', ')}`);
    guidance.push(`ACTION REQUIRED: Remove or change ${diff.key} in ${compareEnv}`);
  }
  
  if (guidance.length === 0) {
    guidance.push(`REVIEW: Determine if ${diff.key} should match ${baseEnv}`);
    guidance.push(`OWNER: ${getOwner(diff.key)}`);
  }
  
  return guidance;
}

/**
 * Format differences as a table
 */
function formatTable(differences, baseEnv, compareEnv) {
  const lines = [];
  
  lines.push(`\n${'═'.repeat(80)}`);
  lines.push(`CONFIGURATION DRIFT REPORT: ${baseEnv.toUpperCase()} → ${compareEnv.toUpperCase()}`);
  lines.push(`${'═'.repeat(80)}\n`);
  
  // Missing keys
  if (differences.missing.length > 0) {
    lines.push(`🔴 MISSING IN ${compareEnv.toUpperCase()} (${differences.missing.length})`);
    lines.push(`─`.repeat(80));
    for (const diff of differences.missing) {
      lines.push(`  ${diff.key}`);
      lines.push(`    Base value: ${diff.baseValue || '(not set)'}`);
      lines.push(`    Category: ${diff.category}`);
      if (diff.isRequired) lines.push(`    ⚠️  REQUIRED`);
      for (const g of getResolutionGuidance(diff, baseEnv, compareEnv)) {
        lines.push(`    ${g}`);
      }
      lines.push('');
    }
  }
  
  // Unexpected keys
  if (differences.unexpected.length > 0) {
    lines.push(`🟡 UNEXPECTED IN ${compareEnv.toUpperCase()} (${differences.unexpected.length})`);
    lines.push(`─`.repeat(80));
    for (const diff of differences.unexpected) {
      lines.push(`  ${diff.key}`);
      lines.push(`    Value: ${diff.compareValue}`);
      lines.push(`    Category: ${diff.category}`);
      for (const g of getResolutionGuidance(diff, baseEnv, compareEnv)) {
        lines.push(`    ${g}`);
      }
      lines.push('');
    }
  }
  
  // Different values
  if (differences.different.length > 0) {
    lines.push(`🟠 DIFFERENT VALUES (${differences.different.length})`);
    lines.push(`─`.repeat(80));
    for (const diff of differences.different) {
      lines.push(`  ${diff.key}`);
      lines.push(`    ${baseEnv}: ${diff.baseValue}`);
      lines.push(`    ${compareEnv}: ${diff.compareValue}`);
      lines.push(`    Category: ${diff.category}`);
      if (diff.isIntentional) lines.push(`    ✓ Intentional difference`);
      for (const g of getResolutionGuidance(diff, baseEnv, compareEnv)) {
        lines.push(`    ${g}`);
      }
      lines.push('');
    }
  }
  
  // Forbidden violations
  if (differences.forbidden_violation.length > 0) {
    lines.push(`🔴 FORBIDDEN VALUE VIOLATIONS (${differences.forbidden_violation.length})`);
    lines.push(`─`.repeat(80));
    for (const diff of differences.forbidden_violation) {
      lines.push(`  ${diff.key}`);
      lines.push(`    ${compareEnv}: ${diff.compareValue} (forbidden: ${diff.forbiddenValues.join(', ')})`);
      lines.push(`    Category: ${diff.category}`);
      for (const g of getResolutionGuidance(diff, baseEnv, compareEnv)) {
        lines.push(`    ${g}`);
      }
      lines.push('');
    }
  }
  
  // Summary
  const total = differences.missing.length + differences.unexpected.length + 
                differences.different.length + differences.forbidden_violation.length;
  
  lines.push(`${'─'.repeat(80)}`);
  if (total === 0) {
    lines.push(`✅ No configuration drift detected`);
  } else {
    lines.push(`📊 SUMMARY: ${total} issue(s) found`);
    lines.push(`   Missing: ${differences.missing.length}`);
    lines.push(`   Unexpected: ${differences.unexpected.length}`);
    lines.push(`   Different: ${differences.different.length}`);
    lines.push(`   Violations: ${differences.forbidden_violation.length}`);
  }
  lines.push(`${'═'.repeat(80)}\n`);
  
  return lines.join('\n');
}

/**
 * Main function
 */
function main() {
  const args = process.argv.slice(2);
  const format = args.includes('--format=json') ? 'json' : 'table';
  const envFilter = args.find(a => a.startsWith('--env='))?.split('=')[1];
  
  const environments = ['development', 'staging', 'production'];
  const results = [];
  
  // Load all configurations
  const configs = {};
  for (const env of environments) {
    try {
      configs[env] = loadEnvConfig(env);
    } catch (e) {
      console.error(`Warning: Could not load ${env} config: ${e.message}`);
    }
  }
  
  // Compare each pair
  const pairs = [];
  if (!envFilter || envFilter === 'staging') {
    pairs.push(['development', 'staging']);
  }
  if (!envFilter || envFilter === 'production') {
    pairs.push(['staging', 'production']);
    pairs.push(['development', 'production']);
  }
  
  for (const [baseEnv, compareEnv] of pairs) {
    if (!configs[baseEnv] || !configs[compareEnv]) continue;
    
    const base = extractExpectedConfig(configs[baseEnv]);
    const compare = extractExpectedConfig(configs[compareEnv]);
    
    const differences = compareConfigs(base, compare, baseEnv, compareEnv);
    
    results.push({
      base: baseEnv,
      compare: compareEnv,
      differences,
    });
    
    if (format === 'table') {
      console.log(formatTable(differences, baseEnv, compareEnv));
    }
  }
  
  // JSON output
  if (format === 'json') {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      results: results.map(r => ({
        ...r,
        differences: {
          ...r.differences,
          // Redact any remaining sensitive data
          missing: r.differences.missing.map(d => ({
            ...d,
            baseValue: typeof d.baseValue === 'string' ? redactValue(d.key, d.baseValue) : d.baseValue,
          })),
        },
      })),
    }, null, 2));
  }
  
  // Exit code based on issues
  const hasErrors = results.some(r => 
    r.differences.missing.some(d => d.isRequired) || 
    r.differences.forbidden_violation.length > 0
  );
  
  if (hasErrors) {
    process.exit(1);
  }
}

main();