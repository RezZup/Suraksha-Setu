# Suraksha Setu Workflow Poster Prompt

Use the prompt below directly in an AI tool (ChatGPT, Claude, Gemini, Gamma, Canva AI, or similar) to generate a presentation-grade workflow poster.

## Complete Prompt (Copy-Paste)

```text
You are a senior product designer and technical communication specialist.
Create a high-resolution academic/project-presentation poster for an AI-powered disaster management platform named "Suraksha Setu".

Poster goal:
Explain the full end-to-end workflow of the platform in a way that is technically accurate, visually clear, and easy to present to judges/faculty.

Audience:
Engineering faculty, hackathon judges, and technical reviewers.

Output requirements:
1) Produce a complete poster blueprint with:
- final poster title and subtitle
- section-wise content (ready to place on poster)
- visual layout instructions (top/middle/bottom + left/right columns)
- diagram specifications for each section
- icon suggestions
- color palette and typography recommendations
- callout boxes for "innovation", "safety", and "impact"
2) Then produce final poster text content exactly as it should appear.
3) Then produce speaker notes (2-3 minutes) to present the poster.

Platform facts to include (do not invent beyond these):
- Name: Suraksha Setu
- Domain: Disaster management and early warning platform for India
- Backend: FastAPI API v3.0 architecture
- Frontend: React 19 web app + PWA behavior
- Data sources: USGS, GDACS, MOSDAC/ISRO, weather/AQI providers
- Core logic: deterministic risk engine + safety safeguards before alerting
- AI layer: role-based agents (citizen, student, scientist, admin) with controlled function-calling tools
- AI modalities: text chat, voice pipeline (STT + orchestrator), vision pipeline (image analysis + authenticity checks), RAG support for scientist workflows
- Notification channels: in-app UI, WebSocket, web push, SMS/WhatsApp, email, Telegram
- Community features: community posts, media upload, image analysis, comments, engagement, report flows
- Admin features: alert review, retraction/approval, AI usage logs, multi-channel broadcast
- Feedback loop: alert feedback (accurate/false_alarm/outdated/duplicate) with trust metrics

Mandatory workflow blocks (in this exact order):
A. Data ingestion and normalization
B. Risk evaluation and safeguards
C. Alert creation and distribution
D. User-facing app modules (dashboard/map/community/student/scientist/admin)
E. AI request lifecycle (role routing + tool execution)
F. Voice and vision specialized pipelines
G. Community intelligence and moderation flow
H. Admin control and multi-channel broadcast
I. Feedback loop and continuous improvement
J. System impact metrics

Design direction:
- Professional, modern, bold, not generic
- Use strong visual hierarchy and minimal clutter
- Prefer white/light neutral background with high-contrast accents
- Include directional arrows and clearly labeled stages
- Show both "real-time operational flow" and "governance/safety loop"

Must include these visual artifacts:
1) One high-level architecture diagram
2) One sequence/flow diagram for alert lifecycle
3) One AI decision loop diagram
4) One multi-channel fan-out diagram
5) One bottom summary strip with key impact numbers placeholders

Include measurable metric placeholders exactly in this format:
- Active Alerts Processed/Day: <value>
- Avg Risk Evaluation Latency: <value>
- Alert Delivery Success Rate: <value>
- Multi-Channel Reach: <value>
- Community Reports Verified: <value>

Poster format constraints:
- Orientation: landscape
- Size: A1 or 1920x1080 equivalent layout
- Readability: all body text concise, no paragraph longer than 40 words
- Add QR placeholder area labeled "Live Demo / GitHub"

Now generate in this structure:
1. Poster concept summary
2. Exact section layout map
3. Detailed content for each section
4. Diagram definitions (what each should contain)
5. Final polished poster text
6. Presenter script (2-3 minutes)
7. Optional: one-slide condensed version
```

## Optional Add-On Prompt (If your AI tool supports image generation)

```text
Generate a 16:9 high-resolution technical project poster titled "Suraksha Setu: AI-Powered Disaster Intelligence and Alerting Platform".
Use a clean, modern infographic style with structured workflow arrows and architecture blocks.
Show these lanes: Data Sources -> Ingestion -> Risk Engine -> Safeguards -> Alert Fan-out -> User Modules -> Feedback Loop.
Include a separate AI lane: Role Router -> Agent -> Tool Executor -> Response.
Include channel icons and labels for WebSocket, Push, SMS/WhatsApp, Email, Telegram.
Use clear section headers, minimal text paragraphs, and diagram-heavy composition suitable for engineering viva/project defense.
```

## Quick Customization Inputs (edit before using)

- Team name: Team QuantBits
- Institute/event: <your institute or hackathon>
- Demo URL: <your deployment URL>
- Repository URL: <your GitHub URL>
- Your measured metrics: replace all <value> placeholders with real values
