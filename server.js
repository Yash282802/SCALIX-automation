require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const OpenAI = require('openai');

const PORT = process.env.PORT || 5500;
const HOST = process.env.HOST || '127.0.0.1';
const DIR = __dirname;
const DATA_DIR = path.join(DIR, 'data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ===== HELPERS =====
function readJSON(file) {
  const p = path.join(DATA_DIR, file);
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
}
function writeJSON(file, data) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

// ===== EMAIL TRANSPORTER =====
const DEFAULT_EMAIL = 'ytiwari2721@gmail.com';

function getTransporter() {
  const cfg = readJSON('email_config.json');
  if (!cfg || !cfg.host) return null;
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port || 587,
    secure: cfg.secure || false,
    auth: { user: cfg.user || DEFAULT_EMAIL, pass: cfg.pass },
  });
}

// ===== OPENAI =====
function getOpenAI() {
  const key = process.env.OPENAI_API_KEY || (readJSON('openai_config.json') || {}).apiKey;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

// ===== SEND EMAIL HELPER =====
async function sendEmailNow(to, subject, html, leadName) {
  const cfg = readJSON('email_config.json');
  if (!cfg || !cfg.host || !cfg.pass) return false;
  try {
    const transporter = nodemailer.createTransport({
      host: cfg.host, port: cfg.port || 587, secure: cfg.secure || false,
      auth: { user: cfg.user || DEFAULT_EMAIL, pass: cfg.pass },
    });
    await transporter.sendMail({
      from: `"Scalix" <${cfg.user || DEFAULT_EMAIL}>`,
      to, subject, html,
    });
    return true;
  } catch (e) {
    console.error('Email send failed:', e.message);
    return false;
  }
}

// ===== AUTOMATION CONFIG =====
function getAutomationConfig() {
  return readJSON('automation_config.json') || {
    enabled: true,
    welcome_email: true,
    welcome_whatsapp: false,
    followup_email: true,
    followup_whatsapp: false,
    followup_days: 3,
    max_followups: 3,
    templates: {
      welcome_email: {
        subject: 'Welcome to Scalix, {{name}}!',
        body: `<h2>Welcome to Scalix, {{name}}!</h2>
<p>Thank you for reaching out, {{name}}. We're excited to help you with <strong>{{service}}</strong>.</p>
<p>Our team will review your requirements and get back to you within 24 hours.</p>
<p>Best regards,<br>The Scalix Team</p>`
      },
      welcome_whatsapp: {
        body: `Hi {{name}}! 👋

Welcome to Scalix! Thank you for your interest in {{service}}.

We'll review your requirements and reach out shortly. In the meantime, feel free to reply here if you have any questions.

— The Scalix Team`
      },
      followup_email: {
        subject: 'Following up, {{name}}',
        body: `<p>Hi {{name}},</p>
<p>We wanted to follow up on your inquiry about <strong>{{service}}</strong>.</p>
<p>If you have any questions or would like to discuss further, please feel free to reply to this email or book a call.</p>
<p><a href="{{booking_link}}" style="background:#1c1c17;color:#fcf9f1;padding:10px 22px;text-decoration:none;font-family:monospace;font-size:12px;">Book a Call</a></p>
<p>Best regards,<br>The Scalix Team</p>`
      },
      followup_whatsapp: {
        body: `Hi {{name}}! 👋

Just checking in — we'd love to help you with {{service}}.

If you're ready to move forward or have any questions, just reply here.

— The Scalix Team`
      }
    }
  };
}

// ===== ROUTER =====
function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  // CORS
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  const url = req.url.split('?')[0];
  const method = req.method;

  // ===== API ROUTES =====
  if (url.startsWith('/api/')) {
    const body = method === 'POST' ? await parseBody(req) : {};

    // --- Email config ---
    if (url === '/api/email-config' && method === 'GET') {
      return sendJSON(res, 200, readJSON('email_config.json') || { configured: false });
    }
    if (url === '/api/email-config' && method === 'POST') {
      writeJSON('email_config.json', { host: body.host, port: body.port || 587, secure: body.secure || false, user: body.user, pass: body.pass });
      return sendJSON(res, 200, { ok: true });
    }
    if (url === '/api/email-test' && method === 'POST') {
      const transporter = getTransporter();
      if (!transporter) return sendJSON(res, 400, { error: 'Email not configured' });
      try {
        await transporter.verify();
        return sendJSON(res, 200, { ok: true, message: 'SMTP connection successful' });
      } catch (e) {
        return sendJSON(res, 400, { error: e.message });
      }
    }

    // --- OpenAI config ---
    if (url === '/api/openai-config' && method === 'GET') {
      return sendJSON(res, 200, { configured: !!process.env.OPENAI_API_KEY || !!(readJSON('openai_config.json') || {}).apiKey });
    }
    if (url === '/api/openai-config' && method === 'POST') {
      writeJSON('openai_config.json', { apiKey: body.apiKey });
      return sendJSON(res, 200, { ok: true });
    }

    // --- AI Generate ---
    if (url === '/api/ai-generate' && method === 'POST') {
      const openai = getOpenAI();
      if (!openai) return sendJSON(res, 400, { error: 'OpenAI not configured. Set OPENAI_API_KEY in .env or configure in Settings.' });
      try {
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a professional business email and WhatsApp message writer for Scalix, a growth infrastructure agency. Write concise, warm, and personalized messages. Keep emails professional and WhatsApp messages friendly.' },
            { role: 'user', content: body.prompt }
          ],
          max_tokens: body.max_tokens || 500,
          temperature: 0.7,
        });
        return sendJSON(res, 200, { text: completion.choices[0].message.content });
      } catch (e) {
        return sendJSON(res, 400, { error: e.message });
      }
    }

    // --- Send Email ---
    if (url === '/api/send-email' && method === 'POST') {
      const cfg = readJSON('email_config.json');
      if (!cfg || !cfg.host) return sendJSON(res, 400, { error: 'Email not configured. Set up SMTP in Settings > Automation.' });
      const transporter = getTransporter();
      try {
        const info = await transporter.sendMail({
          from: `"Scalix" <${cfg.user || DEFAULT_EMAIL}>`,
          to: body.to,
          subject: body.subject,
          html: body.html,
        });
        // Log it
        const log = readJSON('automation_log.json') || [];
        log.unshift({ type: 'email', to: body.to, subject: body.subject, status: 'sent', date: new Date().toISOString(), lead: body.lead || '', template: body.template || '' });
        if (log.length > 200) log.length = 200;
        writeJSON('automation_log.json', log);
        return sendJSON(res, 200, { ok: true, messageId: info.messageId });
      } catch (e) {
        return sendJSON(res, 400, { error: e.message });
      }
    }

    // --- Send WhatsApp ---
    if (url === '/api/send-whatsapp' && method === 'POST') {
      // WhatsApp requires Twilio or WhatsApp Business API
      // For now we log it and simulate
      const log = readJSON('automation_log.json') || [];
      log.unshift({ type: 'whatsapp', to: body.to, body: body.body, status: 'sent', date: new Date().toISOString(), lead: body.lead || '', template: body.template || '' });
      if (log.length > 200) log.length = 200;
      writeJSON('automation_log.json', log);
      return sendJSON(res, 200, { ok: true, note: 'WhatsApp message logged. Configure Twilio/WhatsApp API for actual sending.' });
    }

    // --- Automation Config ---
    if (url === '/api/automation-config' && method === 'GET') {
      return sendJSON(res, 200, getAutomationConfig());
    }
    if (url === '/api/automation-config' && method === 'POST') {
      const existing = getAutomationConfig();
      const merged = { ...existing, ...body };
      writeJSON('automation_config.json', merged);
      return sendJSON(res, 200, { ok: true });
    }

    // --- Automation Log ---
    if (url === '/api/automation-log' && method === 'GET') {
      return sendJSON(res, 200, readJSON('automation_log.json') || []);
    }
    if (url === '/api/automation-log' && method === 'DELETE') {
      writeJSON('automation_log.json', []);
      return sendJSON(res, 200, { ok: true });
    }

    // --- Trigger Automation (from admin) ---
    if (url === '/api/trigger-automation' && method === 'POST') {
      const cfg = getAutomationConfig();
      if (!cfg.enabled) return sendJSON(res, 200, { skipped: true, reason: 'Automation disabled' });

      const log = readJSON('automation_log.json') || [];
      const results = [];

      if (body.event === 'lead_created' || body.event === 'client_created') {
        const isLead = body.event === 'lead_created';

        // Welcome email
        if (isLead && cfg.welcome_email) {
          const tpl = cfg.templates.welcome_email;
          const html = tpl.body.replace(/\{\{name\}\}/g, body.name).replace(/\{\{service\}\}/g, body.service || 'our services');
          const subject = tpl.subject.replace(/\{\{name\}\}/g, body.name).replace(/\{\{service\}\}/g, body.service || 'our services');
          results.push({ type: 'email', template: 'welcome_email', to: body.email });
          const status = await sendEmailNow(body.email, subject, html) ? 'sent' : 'failed';
          log.unshift({ type: 'email', to: body.email, subject, template: 'welcome_email', lead: body.name, status, date: new Date().toISOString() });
        }

        // Welcome WhatsApp
        if (isLead && cfg.welcome_whatsapp && body.phone) {
          const tpl = cfg.templates.welcome_whatsapp;
          const msg = tpl.body.replace(/\{\{name\}\}/g, body.name).replace(/\{\{service\}\}/g, body.service || 'our services');
          results.push({ type: 'whatsapp', template: 'welcome_whatsapp', to: body.phone });
          log.unshift({ type: 'whatsapp', to: body.phone, template: 'welcome_whatsapp', lead: body.name, status: 'sent', date: new Date().toISOString() });
        }
      }

      if (log.length > 200) log.length = 200;
      writeJSON('automation_log.json', log);
      return sendJSON(res, 200, { ok: true, triggered: results });
    }

    // --- Follow-up Check ---
    if (url === '/api/check-followups' && method === 'POST') {
      const cfg = getAutomationConfig();
      if (!cfg.enabled) return sendJSON(res, 200, { ok: true, followups_sent: 0 });

      // Read leads from admin's localStorage won't work server-side.
      // Instead, the admin UI sends leads data in the request body.
      const leads = body.leads || [];
      const sent = { email: 0, whatsapp: 0 };
      const log = readJSON('automation_log.json') || [];
      const now = Date.now();

      for (const lead of leads) {
        if (!lead.email) continue;
        const daysSinceContact = Math.floor((now - new Date(lead.date || now).getTime()) / 86400000);

        // Count existing follow-ups for this lead
        const existingFollowups = log.filter(l => l.lead === lead.name && l.template && l.template.startsWith('followup'));
        if (existingFollowups.length >= cfg.max_followups) continue;
        if (daysSinceContact < cfg.followup_days) continue;

        // Check if already sent a follow-up recently
        const lastFollowup = existingFollowups[0];
        if (lastFollowup) {
          const daysSinceLast = Math.floor((now - new Date(lastFollowup.date).getTime()) / 86400000);
          if (daysSinceLast < cfg.followup_days) continue;
        }

        // Send follow-up email
        if (cfg.followup_email) {
          const tpl = cfg.templates.followup_email;
          const html = tpl.body.replace(/\{\{name\}\}/g, lead.name).replace(/\{\{service\}\}/g, lead.service || 'our services').replace(/\{\{booking_link\}\}/g, 'http://' + HOST + ':' + PORT + '/');
          const subject = tpl.subject.replace(/\{\{name\}\}/g, lead.name);
          const status = await sendEmailNow(lead.email, subject, html, lead.name) ? 'sent' : 'failed';
          sent.email++;
          log.unshift({ type: 'email', to: lead.email, subject, template: 'followup_email', lead: lead.name, status, date: new Date().toISOString() });
        }

        // Send follow-up WhatsApp
        if (cfg.followup_whatsapp && lead.phone) {
          const tpl = cfg.templates.followup_whatsapp;
          const msg = tpl.body.replace(/\{\{name\}\}/g, lead.name).replace(/\{\{service\}\}/g, lead.service || 'our services');
          sent.whatsapp++;
          log.unshift({ type: 'whatsapp', to: lead.phone, template: 'followup_whatsapp', lead: lead.name, status: 'sent', date: new Date().toISOString() });
        }
      }

      if (log.length > 200) log.length = 200;
      writeJSON('automation_log.json', log);
      return sendJSON(res, 200, { ok: true, followups_sent: sent });
    }

    // --- Bulk send (manual trigger from admin) ---
    if (url === '/api/send-bulk' && method === 'POST') {
      const cfg = getAutomationConfig();
      const log = readJSON('automation_log.json') || [];
      const results = [];

      for (const lead of (body.leads || [])) {
        if (!lead.email) continue;

        if (body.template === 'welcome_email') {
          const tpl = cfg.templates.welcome_email;
          const html = tpl.body.replace(/\{\{name\}\}/g, lead.name).replace(/\{\{service\}\}/g, lead.service || 'our services');
          const subject = tpl.subject.replace(/\{\{name\}\}/g, lead.name).replace(/\{\{service\}\}/g, lead.service || 'our services');
          results.push({ lead: lead.name, type: 'email', to: lead.email });
          log.unshift({ type: 'email', to: lead.email, subject, template: 'welcome_email', lead: lead.name, status: 'queued', date: new Date().toISOString() });
        }
        if (body.template === 'welcome_whatsapp' && lead.phone) {
          const tpl = cfg.templates.welcome_whatsapp;
          const msg = tpl.body.replace(/\{\{name\}\}/g, lead.name).replace(/\{\{service\}\}/g, lead.service || 'our services');
          results.push({ lead: lead.name, type: 'whatsapp', to: lead.phone });
          log.unshift({ type: 'whatsapp', to: lead.phone, template: 'welcome_whatsapp', lead: lead.name, status: 'queued', date: new Date().toISOString() });
        }
      }

      if (log.length > 200) log.length = 200;
      writeJSON('automation_log.json', log);
      return sendJSON(res, 200, { ok: true, sent: results.length, results });
    }

    return sendJSON(res, 404, { error: 'API route not found' });
  }

  // ===== STATIC FILES =====
  let fileUrl = url;
  if (fileUrl === '/') fileUrl = '/frontend.html';
  if (fileUrl === '/admin') fileUrl = '/admin.html';

  const filePath = path.join(DIR, fileUrl);
  const ext = path.extname(filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('<h1>404 — Not Found</h1>');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`SCALIX running at http://${HOST}:${PORT}/`);
  console.log(`Admin panel at http://${HOST}:${PORT}/admin`);
  console.log(`Automation API ready`);
});
