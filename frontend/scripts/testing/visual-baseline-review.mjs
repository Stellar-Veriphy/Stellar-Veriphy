/**
 * Visual Baseline Review System
 * 
 * Provides a structured workflow for reviewing and approving intentional
 * visual baseline changes in Playwright visual regression tests.
 * 
 * ## Usage
 * 
 * 1. Run visual tests to generate diffs:
 *    pnpm test:e2e:visual
 * 
 * 2. Review pending changes (creates branch and PR):
 *    node scripts/testing/visual-baseline-review.mjs review
 * 
 * 3. Approve changes after review:
 *    node scripts/testing/visual-baseline-review.mjs approve --all
 * 
 * 4. Cleanup old temporary baselines:
 *    node scripts/testing/visual-baseline-review.mjs cleanup
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, unlinkSync, mkdirSync, rmdirSync } from 'fs';
import { join, basename, dirname } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const SNAPSHOTS_DIR = join(process.cwd(), 'e2e', 'snapshots');
const TEMP_BASELINES_DIR = join(process.cwd(), 'e2e', 'snapshots', '.pending');
const REVIEW_METADATA_FILE = join(process.cwd(), 'e2e', 'snapshots', '.review-metadata.json');
const BASELINE_BRANCH = 'visual-baseline-updates';

/**
 * Get all baseline files that have corresponding actual images
 */
function getPendingBaselines() {
  if (!existsSync(TEMP_BASELINES_DIR)) {
    return [];
  }
  
  const pending = [];
  const files = readdirSync(TEMP_BASELINES_DIR);
  
  for (const file of files) {
    const filePath = join(TEMP_BASELINES_DIR, file);
    if (statSync(filePath).isFile() && file.endsWith('-actual.png')) {
      const baseName = file.replace('-actual.png', '');
      pending.push({
        baseName,
        actualPath: filePath,
        expectedPath: join(SNAPSHOTS_DIR, `${baseName}-expected.png`),
        diffPath: join(SNAPSHOTS_DIR, `${baseName}-diff.png`),
        tempExpectedPath: join(TEMP_BASELINES_DIR, `${baseName}-expected.png`),
        tempActualPath: join(TEMP_BASELINES_DIR, `${baseName}-actual.png`),
      });
    }
  
  return pending;
}

/**
 * Parse affected routes and components from baseline names
 */
function parseAffectedComponents(baseName) {
  const components = [];
  const routes = [];
  
  // Parse patterns like "home-page-chromium.png" or "verify-page-firefox.png"
  const parts = baseName.split('-');
  
  // Known page routes
  const knownRoutes = ['home', 'verify', 'explore', 'certificates', 'not-found', 'dashboard', 'settings'];
  const knownComponents = ['certificate-card', 'verification-badge', 'error-state', 'loading-skeleton', 'header', 'footer', 'modal', 'button', 'input'];
  
  for (const route of knownRoutes) {
    if (parts.includes(route)) {
      routes.push(`/${route === 'home' ? '' : route}`);
      break;
    }
  }
  
  for (const comp of knownComponents) {
    if (baseName.includes(comp)) {
      components.push(comp);
    }
  }
  
  // If no specific component found, derive from the page
  if (components.length === 0 && routes.length > 0) {
    components.push(`${parts[0]}-page`);
  }
  
  return { routes, components };
}

/**
 * Generate diff output highlighting affected routes and components
 */
function generateDiffReport(pending) {
  const report = {
    timestamp: new Date().toISOString(),
    total_changes: pending.length,
    by_route: {},
    by_component: {},
    files: [],
  };
  
  for (const item of pending) {
    const { routes, components } = parseAffectedComponents(item.baseName);
    
    for (const route of routes) {
      if (!report.by_route[route]) {
        report.by_route[route] = [];
      }
      report.by_route[route].push(basename(item.actualPath));
    }
    
    for (const comp of components) {
      if (!report.by_component[comp]) {
        report.by_component[comp] = [];
      }
      report.by_component[comp].push(basename(item.actualPath));
    }
    
    report.files.push({
      name: item.baseName,
      routes,
      components,
      has_expected: existsSync(item.expectedPath),
      has_diff: existsSync(item.diffPath),
    });
  }
  
  return report;
}

/**
 * Display the diff report in a readable format
 */
function displayDiffReport(report) {
  console.log('\n📸 Visual Baseline Changes Report\n');
  console.log(`Total pending changes: ${report.total_changes}\n`);
  
  console.log('─'.repeat(50));
  console.log('AFFECTED ROUTES:');
  console.log('─'.repeat(50));
  
  for (const [route, files] of Object.entries(report.by_route)) {
    console.log(`\n  ${route}:`);
    for (const file of files) {
      console.log(`    - ${file}`);
    }
  }
  
  console.log('\n' + '─'.repeat(50));
  console.log('AFFECTED COMPONENTS:');
  console.log('─'.repeat(50));
  
  for (const [comp, files] of Object.entries(report.by_component)) {
    console.log(`\n  ${comp}:`);
    for (const file of files) {
      console.log(`    - ${file}`);
    }
  }
  
  console.log('\n' + '─'.repeat(50));
  console.log('DETAILED FILE LIST:');
  console.log('─'.repeat(50));
  
  for (const file of report.files) {
    const status = file.has_diff ? '⚠️  diff available' : '📷 actual only';
    console.log(`\n  ${file.name}`);
    console.log(`    Status: ${status}`);
    console.log(`    Routes: ${file.routes.join(', ') || 'N/A'}`);
    console.log(`    Components: ${file.components.join(', ') || 'N/A'}`);
  }
  
  console.log('\n');
}

/**
 * Create a branch for the baseline changes
 */
async function createBaselineBranch() {
  try {
    // Check if branch already exists
    execSync('git rev-parse --verify visual-baseline-updates', { stdio: 'ignore' });
    console.log('Baseline branch already exists, checking out...');
    execSync('git checkout visual-baseline-updates');
  } catch {
    // Branch doesn't exist, create it from main
    execSync('git checkout -B visual-baseline-updates main');
  }
}

/**
 * Commit and prepare PR for baseline changes
 */
async function preparePullRequest(report) {
  console.log('\n📋 Preparing pull request...\n');
  
  // Stage the new baselines
  execSync('git add e2e/snapshots/', { stdio: 'inherit' });
  
  // Check if there are changes to commit
  try {
    execSync('git diff --staged --quiet', { stdio: 'ignore' });
    console.log('No new baselines to commit.');
    return;
  } catch {
    // There are changes
  }
  
  // Commit with descriptive message
  const commitMessage = `test: update visual baselines for ${report.total_changes} snapshot(s)

Affected routes: ${Object.keys(report.by_route).join(', ')}
Affected components: ${Object.keys(report.by_component).join(', ')}

Generated by visual-baseline-review.mjs`;

  execSync(`git commit -m "${commitMessage}"`, { stdio: 'inherit' });
  
  // Push to remote
  console.log('\n🚀 Pushing to remote...');
  execSync('git push -u origin visual-baseline-updates', { stdio: 'inherit' });
  
  // Create PR using gh CLI
  try {
    const prTitle = `test: visual baseline updates (${report.total_changes} snapshot(s))`;
    const prBody = `## Summary

This PR updates visual regression baselines for intentional UI changes.

### Affected Routes
${Object.keys(report.by_route).map(r => `- ${r}`).join('\n')}

### Affected Components  
${Object.keys(report.by_component).map(c => `- ${c}`).join('\n')}

### Review Checklist

- [ ] Visual changes are intentional and match design updates
- [ ] No unintended visual regressions introduced
- [ ] Accessibility: color changes meet WCAG contrast requirements
- [ ] Animation/motion changes respect \`prefers-reduced-motion\`

### Test Evidence

Run \`pnpm test:e2e:visual\` to view the visual diffs.

---
_Generated by visual-baseline-review.mjs_`;

    execSync(`gh pr create --title "${prTitle}" --body "${prBody}" --base main`, { stdio: 'inherit' });
    console.log('\n✅ Pull request created successfully!');
  } catch (e) {
    console.log('\n⚠️  Could not create PR automatically. Please create one manually:');
    console.log('   gh pr create --base main');
  }
}

/**
 * Approve baseline changes (merge the branch)
 */
async function approveChanges(approveAll = false) {
  if (!approveAll) {
    console.log('Interactive approval not implemented. Use --approve-all flag.');
    return;
  }
  
  console.log('\n✅ Approving all baseline changes...\n');
  
  // Checkout main and merge
  execSync('git checkout main');
  execSync('git pull');
  
  try {
    execSync('git merge visual-baseline-updates --no-edit', { stdio: 'inherit' });
    execSync('git push');
    console.log('\n✅ Baseline changes merged and pushed!');
  } catch (e) {
    console.log('\n⚠️  Merge conflict. Please resolve manually:');
    console.log('   git checkout main');
    console.log('   git merge visual-baseline-updates');
    console.log('   # Resolve conflicts');
    console.log('   git push');
  }
  
  // Cleanup branch
  execSync('git branch -d visual-baseline-updates', { stdio: 'inherit' });
}

/**
 * Cleanup old temporary baselines (older than 7 days)
 */
function cleanupTemporaryBaselines() {
  if (!existsSync(TEMP_BASELINES_DIR)) {
    console.log('No temporary baselines to clean up.');
    return;
  }
  
  const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
  const files = readdirSync(TEMP_BASELINES_DIR);
  let cleaned = 0;
  
  for (const file of files) {
    const filePath = join(TEMP_BASELINES_DIR, file);
    const stats = statSync(filePath);
    
    if (stats.mtimeMs < sevenDaysAgo) {
      unlinkSync(filePath);
      cleaned++;
    }
  }
  
  // Remove directory if empty
  const remaining = readdirSync(TEMP_BASELINES_DIR);
  if (remaining.length === 0) {
    rmdirSync(TEMP_BASELINES_DIR);
  }
  
  console.log(`\n🧹 Cleaned up ${cleaned} temporary baseline file(s).\n`);
}

/**
 * Main CLI
 */
async function main() {
  const command = process.argv[2];
  
  switch (command) {
    case 'review':
      console.log('🔍 Scanning for visual baseline changes...\n');
      
      const pending = getPendingBaselines();
      
      if (pending.length === 0) {
        console.log('No pending baseline changes found.');
        console.log('\nTo generate new baselines:');
        console.log('  pnpm test:e2e:visual --update-snapshots');
        return;
      }
      
      const report = generateDiffReport(pending);
      displayDiffReport(report);
      
      console.log('To approve these changes:');
      console.log('  node scripts/testing/visual-baseline-review.mjs approve --all');
      console.log('\nTo cleanup old temporary baselines:');
      console.log('  node scripts/testing/visual-baseline-review.mjs cleanup');
      break;
    
    case 'approve':
      const approveAll = process.argv.includes('--all');
      await approveChanges(approveAll);
      break;
    
    case 'cleanup':
      cleanupTemporaryBaselines();
      break;
    
    default:
      console.log(`
🔧 Visual Baseline Review System

Usage:
  review     Scan and display pending baseline changes
  approve    Approve and merge baseline changes (requires --all)
  cleanup    Remove old temporary baselines

Examples:
  node scripts/testing/visual-baseline-review.mjs review
  node scripts/testing/visual-baseline-review.mjs approve --all
  node scripts/testing/visual-baseline-review.mjs cleanup

Workflow:
  1. Run visual tests: pnpm test:e2e:visual
  2. Review changes:  node scripts/testing/visual-baseline-review.mjs review
  3. After approval:  node scripts/testing/visual-baseline-review.mjs approve --all
`);
  }
}

main().catch(console.error);