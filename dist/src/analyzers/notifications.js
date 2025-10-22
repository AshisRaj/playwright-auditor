import path from 'path';
import { applyScore, createCategory, inDeps, readFile, readJsonSafe, walkFiles, } from '../utils/helpers.js';
const cat = createCategory('notify', 'Notification');
/**
 * Strong signals for email configuration/usage
 * - nodemailer.createTransport(...) + sendMail(...)
 * - @sendgrid/mail with setApiKey(...) and send(...)
 * - AWS SES client usage (v3) + send
 * - Common SMTP envs + explicit mail send call
 */
function hasEmailEvidence(text) {
    if (!text)
        return false;
    // Nodemailer
    if (/nodemailer/i.test(text) && /createTransport\s*\(/.test(text) && /sendMail\s*\(/.test(text)) {
        return true;
    }
    // SendGrid
    if (/@sendgrid\/mail/.test(text) &&
        /setApiKey\s*\(/.test(text) &&
        /\.(send|sendMultiple)\s*\(/.test(text)) {
        return true;
    }
    // AWS SES v3 client
    if (/@aws-sdk\/client-ses/.test(text) &&
        /(new\s+SESClient\s*\(|SendEmailCommand\s*\()/.test(text)) {
        return true;
    }
    // Generic SMTP env + a send function nearby
    if (/(SMTP_HOST|SMTP_SERVER|SMTP_USER|SMTP_PASS|SMTP_PORT)/i.test(text) &&
        /(sendMail|send\()/.test(text)) {
        return true;
    }
    return false;
}
/**
 * Strong signals for Slack notification
 * - Slack webhook URL
 * - @slack/webhook or @slack/web-api usage with postMessage/chat.postMessage
 */
function hasSlackEvidence(text) {
    if (!text)
        return false;
    // Incoming webhook URL (most common)
    if (/https?:\/\/hooks\.slack\.com\/services\/[A-Z0-9/]+/i.test(text))
        return true;
    // Official SDK/webhook pkg
    if (/@slack\/webhook/.test(text) && /(new\s+IncomingWebhook\s*\(|send\s*\()/.test(text))
        return true;
    // Web API
    if (/@slack\/web-api/.test(text) && /(chat\.postMessage|conversations\.|users\.)/.test(text))
        return true;
    // Basic fetch/axios to Slack API
    if (/slack\.com\/api\//i.test(text) && /(fetch|axios|got)\s*\(/.test(text))
        return true;
    return false;
}
/**
 * Strong signals for generic webhooks
 * - axios/fetch/got POST to a non-local URL (http(s)://...),
 *   not Playwright internal URLs.
 */
function hasWebhookEvidence(text) {
    if (!text)
        return false;
    const hasHttpPost = /(axios\.(post|request)\s*\(|fetch\s*\(|got\.\w+\s*\()/.test(text) &&
        /(method\s*:\s*['"]POST['"]|\.post\s*\()/.test(text);
    const hasUrl = /https?:\/\/(?!localhost|127\.0\.0\.1)/i.test(text);
    return hasHttpPost && hasUrl;
}
export async function analyzeNotifications(targetDir) {
    // ---- Collect project files (NOT node_modules) ----
    // search only typical code roots
    const roots = ['src', 'tests', 'test', 'e2e', '__tests__', 'scripts'];
    const files = [];
    for (const r of roots) {
        const full = path.join(targetDir, r);
        const found = await walkFiles(full, { exts: /\.(t|j)sx?$/i, limit: 5000 });
        files.push(...found);
    }
    // Read package.json (helps resolve intent)
    const pkg = await readJsonSafe(path.join(targetDir, 'package.json'));
    // ---- Scan texts (keep it light; stop early if all three are proven) ----
    let slack = false;
    let webhook = false;
    let email = false;
    for (const f of files) {
        const txt = await readFile(f);
        if (!slack && hasSlackEvidence(txt))
            slack = true;
        if (!webhook && hasWebhookEvidence(txt))
            webhook = true;
        if (!email && hasEmailEvidence(txt))
            email = true;
        if (slack && webhook && email)
            break;
    }
    // If deps strongly suggest capability but usage is not found,
    // consider it NOT configured (we require usage/config evidence).
    // This avoids false passes.
    const checks = [
        [
            'Slack notifications',
            slack,
            'info',
            'Slack notifications detected',
            'No Slack notification configuration/usage was found (incoming webhook or Web API).',
        ],
        [
            'Webhook notifications',
            webhook,
            'info',
            'Generic webhook notifications detected',
            'No generic webhook POST usage detected (axios/fetch/got to non-local URL).',
        ],
        [
            'Email notifications',
            email &&
                (inDeps(pkg, ['nodemailer', '@sendgrid/mail', '@aws-sdk/client-ses']) ||
                    true) /* deps optional, usage evidence already strong */,
            'info',
            'Email notifications detected',
            'No email notification configuration/usage found (nodemailer/sendgrid/SES).',
        ],
    ];
    for (const [title, pass, sev, msgPass, msgFail] of checks) {
        cat.findings.push({
            id: 'notif-' + title.toLowerCase().replace(/\W+/g, '-'),
            title,
            message: pass ? msgPass : msgFail,
            severity: sev,
            status: pass ? 'pass' : 'fail',
        });
    }
    cat.score = applyScore(cat.findings);
    return cat;
}
