import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const dataDir = path.join(rootDir, 'data');

const KEYWORD_REGEX = /(練習日|練習会|練習|日程|開催|会場|参加|交流会|焼津|イチフジ|静ジャグ)/i;

const ACCOUNTS = [
  'shizujugg',
  'yaijug',
  'jugg_ichifuji'
];

const MAX_POSTS_PER_ACCOUNT = 10;

// Ensure data directory exists
function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

// Load previous state
function loadState() {
  const statePath = path.join(dataDir, 'state.json');
  if (fs.existsSync(statePath)) {
    try {
      return JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch {
      return { seenPostIds: {} };
    }
  }
  return { seenPostIds: {} };
}

// Save state
function saveState(state) {
  const statePath = path.join(dataDir, 'state.json');
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

// Normalize text
function normalizeText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

// Extract posts from page
async function extractPosts(page) {
  const posts = [];
  
  // Try to dismiss overlays
  try {
    const closeButtons = await page.$$('button[aria-label*="Close"]');
    for (const btn of closeButtons) {
      await btn.click().catch(() => {});
    }
  } catch {
    // Ignore overlay dismissal failures
  }
  
  // Scroll once
  await page.evaluate(() => {
    window.scrollBy(0, window.innerHeight);
  });
  
  // Wait briefly for content to load
  await page.waitForTimeout(1000);
  
  // Extract articles
  const articles = await page.$$eval('article', elements => {
    return elements.slice(0, 20).map(article => {
      // Get text content
      const text = article.innerText || article.textContent || '';
      
      // Try to extract a post ID from the article link
      const link = article.querySelector('a[href*="/status/"]');
      const postId = link?.href?.match(/\/status\/(\d+)/)?.[1] || null;
      
      return {
        text: text.trim(),
        postId: postId,
        html: article.outerHTML
      };
    });
  }).catch(() => []);
  
  // Filter by keyword regex
  for (const article of articles) {
    if (KEYWORD_REGEX.test(article.text)) {
      const normalized = normalizeText(article.text);
      posts.push({
        text: normalized,
        postId: article.postId
      });
      
      if (posts.length >= MAX_POSTS_PER_ACCOUNT) {
        break;
      }
    }
  }
  
  return posts;
}

// Monitor a single account
async function monitorAccount(browser, handle) {
  const url = `https://x.com/${handle}`;
  let posts = [];
  
  try {
    const context = await browser.createContext({
      locale: 'ja-JP',
      timezoneId: 'Asia/Tokyo',
      headless: true
    });
    
    const page = await context.newPage();
    
    // Set a user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    
    await page.goto(url, { waitUntil: 'load', timeout: 30000 }).catch(() => {});
    
    // Wait for content to be available
    await page.waitForTimeout(2000);
    
    posts = await extractPosts(page);
    
    await context.close();
  } catch (error) {
    console.error(`Error monitoring ${handle}:`, error.message);
  }
  
  return { handle, posts };
}

// Self-test mode
async function selfTest() {
  console.log('Running self-test mode...');
  
  ensureDataDir();
  const state = loadState();
  
  // Create mock data
  const mockResults = [
    {
      handle: 'shizujugg',
      posts: [
        { text: '7月15日 練習会を開催します', postId: '1001' },
        { text: '静ジャグ交流会 参加受付中', postId: '1002' }
      ]
    },
    {
      handle: 'yaijug',
      posts: [
        { text: '焼津ジャグリング練習 日程のご案内', postId: '2001' }
      ]
    },
    {
      handle: 'jugg_ichifuji',
      posts: [
        { text: 'イチフジ練習会 会場変更のお知らせ', postId: '3001' }
      ]
    }
  ];
  
  // Process results
  const newPosts = [];
  for (const result of mockResults) {
    if (!state.seenPostIds[result.handle]) {
      state.seenPostIds[result.handle] = [];
    }
    
    for (const post of result.posts) {
      if (!state.seenPostIds[result.handle].includes(post.postId)) {
        newPosts.push({ handle: result.handle, ...post });
        state.seenPostIds[result.handle].push(post.postId);
      }
    }
  }
  
  saveState(state);
  
  const summary = {
    timestamp: new Date().toISOString(),
    totalAccounts: mockResults.length,
    totalPosts: mockResults.reduce((sum, r) => sum + r.posts.length, 0),
    newPosts: newPosts.length,
    results: mockResults
  };
  
  // Save latest.json
  fs.writeFileSync(path.join(dataDir, 'latest.json'), JSON.stringify(summary, null, 2));
  
  // Generate markdown
  let markdown = `# X Practice Monitor Report\n\n`;
  markdown += `Generated: ${new Date().toISOString()}\n\n`;
  
  for (const result of mockResults) {
    markdown += `## @${result.handle}\n\n`;
    for (const post of result.posts) {
      markdown += `- ${post.text}\n`;
    }
    markdown += '\n';
  }
  
  fs.writeFileSync(path.join(dataDir, 'latest.md'), markdown);
  
  // Generate HTML
  let html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>X Practice Monitor</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 20px; color: #333; }
    h1 { color: #000; }
    h2 { color: #1DA1F2; border-bottom: 2px solid #e1e8ed; padding-bottom: 10px; }
    .post { margin: 10px 0; padding: 10px; background: #f7f9fa; border-left: 4px solid #1DA1F2; }
    .timestamp { color: #657786; font-size: 0.9em; }
    .summary { background: #e7f5ff; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
  </style>
</head>
<body>
  <h1>X Practice Monitor Report</h1>
  <div class="timestamp">Generated: ${new Date().toISOString()}</div>
  <div class="summary">
    <p><strong>Total Accounts:</strong> ${summary.totalAccounts}</p>
    <p><strong>Total Posts:</strong> ${summary.totalPosts}</p>
    <p><strong>New Posts:</strong> ${summary.newPosts}</p>
  </div>`;
  
  for (const result of mockResults) {
    html += `<h2>@${result.handle}</h2>`;
    for (const post of result.posts) {
      html += `<div class="post">${post.text}</div>`;
    }
  }
  
  html += `</body></html>`;
  fs.writeFileSync(path.join(dataDir, 'index.html'), html);
  
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

// Main function
async function main() {
  const isSelfTest = process.argv.includes('--self-test');
  
  if (isSelfTest) {
    selfTest();
    return;
  }
  
  ensureDataDir();
  const state = loadState();
  
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    
    // Monitor all accounts
    const results = [];
    for (const handle of ACCOUNTS) {
      const result = await monitorAccount(browser, handle);
      results.push(result);
    }
    
    // Process results
    const newPosts = [];
    for (const result of results) {
      if (!state.seenPostIds[result.handle]) {
        state.seenPostIds[result.handle] = [];
      }
      
      for (const post of result.posts) {
        if (!state.seenPostIds[result.handle].includes(post.postId)) {
          newPosts.push({ handle: result.handle, ...post });
          state.seenPostIds[result.handle].push(post.postId);
        }
      }
    }
    
    saveState(state);
    
    // Generate summary
    const summary = {
      timestamp: new Date().toISOString(),
      totalAccounts: results.length,
      totalPosts: results.reduce((sum, r) => sum + r.posts.length, 0),
      newPosts: newPosts.length,
      results: results
    };
    
    // Save latest.json
    fs.writeFileSync(path.join(dataDir, 'latest.json'), JSON.stringify(summary, null, 2));
    
    // Generate markdown
    let markdown = `# X Practice Monitor Report\n\n`;
    markdown += `Generated: ${new Date().toISOString()}\n\n`;
    
    for (const result of results) {
      markdown += `## @${result.handle}\n\n`;
      if (result.posts.length === 0) {
        markdown += `No matching posts found.\n\n`;
      } else {
        for (const post of result.posts) {
          markdown += `- ${post.text}\n`;
        }
        markdown += '\n';
      }
    }
    
    fs.writeFileSync(path.join(dataDir, 'latest.md'), markdown);
    
    // Generate HTML
    let html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>X Practice Monitor</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 20px; color: #333; }
    h1 { color: #000; }
    h2 { color: #1DA1F2; border-bottom: 2px solid #e1e8ed; padding-bottom: 10px; }
    .post { margin: 10px 0; padding: 10px; background: #f7f9fa; border-left: 4px solid #1DA1F2; }
    .timestamp { color: #657786; font-size: 0.9em; }
    .summary { background: #e7f5ff; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
    .no-posts { color: #657786; font-style: italic; }
  </style>
</head>
<body>
  <h1>X Practice Monitor Report</h1>
  <div class="timestamp">Generated: ${new Date().toISOString()}</div>
  <div class="summary">
    <p><strong>Total Accounts:</strong> ${summary.totalAccounts}</p>
    <p><strong>Total Posts:</strong> ${summary.totalPosts}</p>
    <p><strong>New Posts:</strong> ${summary.newPosts}</p>
  </div>`;
    
    for (const result of results) {
      html += `<h2>@${result.handle}</h2>`;
      if (result.posts.length === 0) {
        html += `<div class="no-posts">No matching posts found.</div>`;
      } else {
        for (const post of result.posts) {
          html += `<div class="post">${post.text}</div>`;
        }
      }
    }
    
    html += `</body></html>`;
    fs.writeFileSync(path.join(dataDir, 'index.html'), html);
    
    // Output summary to stdout
    console.log(JSON.stringify(summary, null, 2));
    
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
