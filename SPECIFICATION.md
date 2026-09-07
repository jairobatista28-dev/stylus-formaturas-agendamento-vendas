# Stylus Formaturas — AI-Powered Appointment Scheduling System
## Technical Specification Document

---

## 1. System Architecture Design

### 1.1 Core Components

- **Frontend Application** — A dark mode React-based web application built with Vite and Tailwind CSS. Provides the dashboard, appointment list, user management, and WhatsApp scheduling interfaces.
- **Supabase Backend** — Serves as the primary data persistence layer for graduand data, appointments, sales records, users, and configurations. Includes Row Level Security (RLS) policies for authenticated access.
- **AI Orchestration Layer** — Powered by N8N workflows, handles personalized data collection, automated appointment scheduling, and mass outreach. No code is required to configure or modify AI scheduling steps.
- **Google Calendar Integration** — Synchronizes confirmed appointments to Stylus Formaturas' shared calendar, providing real-time availability and conflict prevention.
- **WhatsApp Integration** — Dual-mode messaging system supporting AI-driven (automated) and manual (human-initiated) outreach for scheduling and follow-up.

### 1.2 Dark Mode UI Foundation

- The entire application operates in a cohesive dark mode palette.
- Neutral tones (slate/gray/zinc) form the base with subtle depth achieved through layered surfaces and soft borders.
- Primary accents use a refined teal or amber tone to represent Stylus Formaturas brand identity.
- High contrast ratios are maintained for all text and interactive elements to ensure readability.
- Smooth transitions and micro-interactions are applied to state changes, hover effects, and page transitions.

### 1.3 No-Code Philosophy

- Data collection steps (form fields, questions, validation rules) are configured via a visual form builder in the admin panel.
- Scheduling workflows are assembled in N8N using a drag-and-drop interface. Triggers, actions, and conditions are represented as nodes, not code.
- WhatsApp message templates and AI prompt behaviors are managed through a dedicated configuration screen, not code files.
- New appointment types, locations, or shifts can be added through the UI without developer intervention.

---

## 2. AI-Powered Scheduling Flow

### 2.1 Personalized Data Collection

- **Dynamic Form Builder**: Administrators create data collection flows using a visual form builder. Fields include: name, contract number, course, email, phone, preferred location, and custom questions specific to the graduation package.
- **AI-Powered Conversations**: When a graduand interacts via WhatsApp or the web form, the AI (via N8N) guides them through the configured questions. The AI adapts its tone and phrasing based on the context of the conversation.
- **Validation & Branching**: The AI validates responses in real-time (e.g., checking if a contract number exists in the database). Based on responses, the AI branches the conversation—skipping irrelevant questions or escalating to a human.
- **Data Storage**: Collected responses are written directly to the Supabase `graduands` table and linked to the respective appointment record.

### 2.2 Automated Appointment Scheduling

- **Availability Engine**: The AI queries the Supabase `appointments` table and Google Calendar to determine open slots for a given date, shift, and location.
- **Smart Suggestions**: The AI proposes 2-3 available slots to the graduand, ranked by proximity to their preference or by under-booked slots to balance load.
- **Confirmation Loop**: Once a graduand selects a slot, the AI reserves it temporarily (pending confirmation) and creates a calendar event upon final confirmation. The reservation expires after 15 minutes if not confirmed.
- **Rescheduling**: Graduands can request rescheduling via WhatsApp. The AI handles the cancellation of the old slot and proposes new alternatives, updating all records and Google Calendar.

### 2.3 Mass Outreach Mechanism

- **Campaign Builder**: Users create outreach campaigns by selecting a target audience (e.g., all graduands from a specific course who have not yet scheduled). Filters are applied via a visual query builder (no code).
- **Batch Messaging**: N8N processes the selected audience in batches. The AI sends personalized WhatsApp messages to each graduand, addressing them by name and referencing their course/contract.
- **Follow-up Sequences**: Unresponsive graduands automatically receive follow-up messages at configurable intervals (e.g., 24h, 72h) until they respond or the campaign concludes.
- **Campaign Analytics**: Each campaign tracks sends, reads, responses, scheduled appointments, and conversion rates, visible in a campaign summary view.

---

## 3. User Interface (UI) and User Experience (UX)

### 3.1 Dark Mode Design Requirements

- **Color System**: Primary background uses `#0F1117` (deep slate). Surface cards use `#1A1D2E`. Borders are subtle at `rgba(255,255,255,0.06)`.
- **Typography**: A clean sans-serif font (Inter or similar) at 150% line spacing for body text and 120% for headings. Maximum 3 font weights (Regular, Medium, Semibold).
- **Spacing**: 8px base grid system. Cards and sections use consistent 16px–24px internal padding and 24px–32px external spacing.
- **Interactive Elements**: Buttons have visible hover states with subtle background shifts. Inputs use a soft glow on focus. Loading states use skeleton screens or pulsing animations.
- **Accessibility**: All text maintains WCAG AA contrast ratios on dark backgrounds. Focus indicators are clearly visible for keyboard navigation.

### 3.2 Side Menu Layout

The side menu is a persistent vertical navigation bar on the left side of the screen containing:

- **Dashboard** — Overview of KPIs, sales rankings, and summarized data.
- **Appointments** — The tabular appointment list with filters and actions.
- **WhatsApp Scheduling** — A submenu with two options:
  - *AI-Driven* — Launch or manage AI-powered WhatsApp campaigns and automated scheduling.
  - *Manual* — Send individual WhatsApp messages, manage conversations, and manually schedule appointments.
- **Campaigns** — Manage mass outreach campaigns and view their performance.
- **User Configuration** — Profile settings, user management, and system settings.

Each menu item uses a Lucide icon alongside a label. The active item is highlighted with a subtle background and accent color indicator.

### 3.3 WhatsApp Integration

- **AI-Driven Mode**: Initiated from the side menu. Users select a campaign template and target audience. The AI handles the entire conversation flow, from initial outreach to appointment confirmation. The conversation history is stored in Supabase and visible in a chat log view.
- **Manual Mode**: Provides a direct chat interface. Users see a list of graduands and can open individual conversations. Messages are sent via a WhatsApp Business API integration (managed by N8N). Users can manually schedule appointments directly from the chat interface by clicking a "Schedule Appointment" button that opens the appointment form pre-filled with the graduand's data.
- **Message Templates**: Both modes support pre-approved WhatsApp message templates (required for business API). Templates are configured in the admin section and can be personalized with merge fields (e.g., `{{nome}}`, `{{curso}}`).
- **Status Indicators**: Sent, delivered, and read receipts are visible in both modes.

---

## 4. Dashboard Development

### 4.1 Dashboard Data Points

The main dashboard is the first view after login and displays the following sections:

- **Summary Cards** — A row of key metrics at the top:
  - Total appointments scheduled in the period
  - Total sales completed in the period
  - Total revenue in the period
  - Total graduands reached via campaigns

- **Sales Conversion Rate** — A prominent percentage card showing the ratio of scheduled appointments that resulted in sales. Calculated as: `(sold appointments / total scheduled appointments) * 100`. Includes a visual gauge or progress indicator.

- **Average Ticket per Salesperson** — A ranked list or chart showing each salesperson's average sale value. This is calculated as: `total sales value / number of sales` per salesperson.

- **Sales Ranking** — A bar or leaderboard chart ranking salespeople by total sales volume and total revenue for the selected period.

- **Appointment Trends** — A line chart showing the volume of scheduled appointments over time (grouped by day or week within the selected period).

- **Location & Shift Distribution** — Small pie or donut charts showing the distribution of appointments across locations and shifts.

### 4.2 Date Filtering

- **Date Range Selector**: Positioned at the top of the dashboard. Defaults to the current month. Supports quick presets (Today, Yesterday, Last 7 Days, This Month, Last Month, This Quarter, Custom Range).
- **Custom Range Picker**: A calendar widget allowing start and end date selection.
- **Period Granularity**: When viewing a long period, the user can toggle grouping (daily, weekly, monthly) for trend charts.
- **Filter Persistence**: The selected date range is stored in the URL query parameters so that the filter survives page refreshes and can be shared.

### 4.3 Dynamic Data Updates

- **Real-time Updates**: The dashboard subscribes to Supabase Realtime for changes to the `appointments` and `sales` tables. When a new appointment is scheduled, a sale is marked, or a status changes, the affected cards and charts update automatically without requiring a page refresh.
- **Data Refresh**: A manual "Refresh" button is available for all dashboard sections. Clicking it re-fetches data from the backend and re-renders the components.
- **Loading States**: While data is being fetched or calculated, cards and charts show skeleton loaders or subtle pulse animations.
- **Empty States**: When no data exists for the selected period, the dashboard displays friendly empty-state illustrations with actionable prompts (e.g., "No appointments this week. Launch a campaign?").

---

## 5. Appointment List

### 5.1 Table Columns

The appointment list is accessible via a dedicated tab in the side menu and displays a data table with the following columns:

| Column | Description |
|--------|-------------|
| **Nome** | Graduand's full name (from the graduand record). |
| **Contrato** | Contract number associated with the graduand. |
| **Curso** | Course name or program the graduand is graduating from. |
| **Data** | Scheduled appointment date. |
| **Turno** | Shift (e.g., Morning, Afternoon, Evening). |
| **Local** | Location where the appointment is scheduled. |
| **Vendedor** | Salesperson responsible for the graduand/appointment. |
| **Status** | Current appointment status (e.g., Scheduled, Confirmed, Completed, Cancelled, No-show, Sold). Visualized with a colored badge. |
| **Valor da Venda** | Final sale value if the appointment resulted in a sale. Displayed as currency. |
| **Ações** | Action buttons (Visualizar, Editar, Excluir). |

### 5.2 Table Functionality

- **Pagination**: The table paginates results (default 25 rows per page). Users can adjust the page size (25, 50, 100).
- **Sorting**: Each column is sortable (ascending/descending). Default sort is by appointment date descending.
- **Column Filtering**: Individual columns support filtering (e.g., filter by status, filter by salesperson, filter by date range). Filters are applied client-side for small datasets and server-side for large datasets.
- **Global Search**: A search bar at the top of the table allows searching across all text-based columns (name, contract, course, salesperson).
- **Bulk Actions**: Users can select multiple rows via checkboxes to perform bulk actions (e.g., change status, delete, export).
- **Export**: A "Export to CSV" button is available to download the current filtered view.
- **Row Density**: Users can toggle between comfortable, compact, and spacious row heights.

### 5.3 Action Buttons

Each row in the **Ações** column contains three icon buttons:

- **Visualizar** (View/Eye icon) — Opens a detailed view of the appointment in a modal or slide-out drawer. Shows all graduand data, collected responses, conversation history, and calendar status.
- **Editar** (Edit/Pencil icon) — Opens an edit form in a modal or slide-out drawer. Allows modification of date, shift, location, status, salesperson, and sale value. On save, the appointment is updated in Supabase and Google Calendar is synchronized.
- **Excluir** (Delete/Trash icon) — Opens a confirmation dialog. On confirmation, the appointment is soft-deleted (status changed to "Deleted" or a `deleted_at` timestamp is set) so the record remains for audit purposes. The corresponding Google Calendar event is cancelled.

### 5.4 Automatic List Generation

- The appointment list is automatically populated from the `appointments` table in Supabase.
- The list is auto-generated based on the current query and filters. No manual refresh is required—new appointments appear in the list as they are created (via Realtime subscription).
- The list is responsive: on mobile viewports, the table collapses into a card-based list view with the same columns represented as labeled rows within each card.

---

## 6. Integration Strategy

### 6.1 Google Calendar Integration

- **OAuth 2.0 Authentication**: The application authenticates with Google Calendar using OAuth 2.0. The integration is managed via the User Configuration screen. Administrators authorize the Stylus Formaturas Google account to allow calendar access.
- **Calendar Selection**: Users select which Google Calendar(s) to sync appointments to. This is configurable per location or shift if needed.
- **Event Synchronization**:
  - **Create**: When an appointment is confirmed, a Google Calendar event is created with the graduand's name, course, location, and salesperson as the event description. The event is set as "busy" to prevent double-booking.
  - **Update**: When an appointment is edited (date, time, location), the corresponding calendar event is updated automatically.
  - **Delete/Cancel**: When an appointment is deleted or cancelled, the calendar event is removed.
- **Conflict Detection**: Before scheduling, the system queries Google Calendar to check if the proposed slot is free. If the slot is occupied, the AI proposes alternative times.
- **Two-Way Sync (Optional)**: If a calendar event is directly modified in Google Calendar, the change can be reflected back in the system via a webhook or periodic polling. This is optional and configurable.
- **Sync Status**: Each appointment record stores a `calendar_event_id` and `calendar_sync_status` (Synced, Pending, Failed) for troubleshooting.

### 6.2 N8N Integration

- **Workflow Triggering**: N8N workflows are triggered via webhooks from the application. Common triggers include: new graduand inquiry, appointment status change, campaign launch request, and manual message send.
- **Workflow Orchestration**: N8N handles the following workflows:
  - **AI Data Collection**: Receives incoming WhatsApp messages, forwards them to an AI service (OpenAI/Claude), and stores structured responses back in Supabase.
  - **Appointment Scheduling**: Queries availability, creates calendar events, and sends confirmation messages.
  - **Mass Outreach**: Receives a campaign definition, segments the audience, batches messages, and handles follow-up sequences.
  - **WhatsApp API**: Manages all outgoing and incoming WhatsApp messages through the WhatsApp Business API.
- **Webhook Configuration**: N8N webhook URLs are configured in the User Configuration screen. Each workflow type maps to a specific webhook endpoint.
- **Error Handling**: N8N workflows include error handling nodes. Failed operations (e.g., message not sent, calendar not created) are logged to a Supabase `integration_logs` table and surfaced in the UI for review.
- **No-Code Workflow Management**: The N8N editor is accessible via a link in the User Configuration section. Non-technical users can modify message templates, adjust follow-up timing, or add new AI prompts by rearranging nodes in the N8N canvas.

---

## 7. User Management and Configuration

### 7.1 User Configuration Section

Accessible via the side menu, the User Configuration section contains multiple sub-tabs:

- **Profile** — Allows the current user to update their name, email, password, phone number, and notification preferences.
- **Team Management** — (Admin-only) Allows administrators to add, edit, and deactivate salesperson accounts. Each user has: name, email, role (Admin/Salesperson), phone number, and a default location.
- **Settings** — System-wide configuration:
  - Google Calendar connection (OAuth, calendar selection, sync preferences).
  - N8N webhook URLs and API keys.
  - WhatsApp Business API credentials and webhook configuration.
  - Default appointment locations, shifts, and available time slots.
  - Message templates and AI prompt templates.
  - Campaign default settings (follow-up intervals, batch size, time of day for sending).
- **Notification Preferences** — Configure which events trigger notifications (email, in-app, WhatsApp). Includes: new appointment, cancelled appointment, new sale, campaign completion, and sync errors.
- **Audit Logs** — (Admin-only) A view of all system actions (appointment creation, edits, deletions, user logins, configuration changes) with timestamps and the responsible user.

### 7.2 User Registration and Authentication

- **Authentication**: Users authenticate via Supabase Auth using email and password. Email confirmation is disabled for ease of onboarding.
- **Role-Based Access**: Two roles are defined:
  - **Admin** — Full access to all sections, including team management, system settings, and audit logs.
  - **Salesperson** — Access to the dashboard (filtered to their own data), appointment list (filtered to their own sales), WhatsApp manual scheduling, and their own profile. Cannot view other salespeople's data or modify system settings.
- **Row Level Security (RLS)**: Supabase RLS policies enforce role-based access at the database level. Salespeople can only read/update/delete appointments where `vendedor_id = auth.uid()`.
- **Password Policy**: Minimum 8 characters. Password resets are handled via a Supabase password reset flow initiated from the login screen.

### 7.3 Onboarding Flow

- When a new user is invited by an Admin, they receive an email with a set-password link.
- On first login, the user sees a brief onboarding tour highlighting the side menu, dashboard, and appointment list.
- The tour is dismissible and can be re-triggered from the Help section.

---

## 8. Data Model Overview

### Key Tables

- **`graduands`** — Stores graduand personal data and collected responses (nome, contrato, curso, email, telefone, curso, etc.).
- **`appointments`** — Stores scheduled appointments (graduand_id, data, turno, local, vendedor_id, status, valor_da_venda, calendar_event_id, etc.).
- **`sales`** — Stores completed sales (appointment_id, valor, vendedor_id, data_venda, etc.).
- **`users`** — Supabase Auth users table extended with profile data (nome, telefone, role, default_location).
- **`campaigns`** — Stores mass outreach campaigns (nome, audience_filter, status, created_at, created_by).
- **`campaign_messages`** — Stores individual messages sent in a campaign (campaign_id, graduand_id, status, sent_at, read_at, responded_at).
- **`integration_logs`** — Stores N8N and Google Calendar sync errors (source, level, message, details, created_at).
- **`message_templates`** — Stores pre-approved WhatsApp message templates (nome, corpo, variaveis, is_approved, etc.).
- **`locations`** — Stores available appointment locations (nome, endereco, telefone, calendario_id).
- **`shifts`** — Stores available shifts (nome, hora_inicio, hora_fim, duracao_slot).

---

## 9. Non-Functional Requirements

- **Performance**: The dashboard should load initial data within 2 seconds. Appointment list should paginate and filter without perceptible lag. Realtime updates should be visible within 1 second.
- **Security**: All API calls use authenticated Supabase clients. RLS policies are enabled on all tables. Sensitive data (WhatsApp API keys, Google credentials) is stored in Supabase Edge Function secrets or environment variables, never exposed to the client.
- **Scalability**: The N8N batch processing should handle up to 5,000 graduands per campaign. The Supabase database should support concurrent access by multiple salespeople without performance degradation.
- **Reliability**: Google Calendar sync failures should be retried up to 3 times with exponential backoff. N8N webhook failures should be logged and surfaced in the UI. Appointment data should never be hard-deleted; use soft deletes with audit trails.
- **Accessibility**: The application should be fully navigable via keyboard. All interactive elements should have visible focus states. Color should never be the sole indicator of status (icons or text labels accompany status badges).

---

## 10. Success Criteria

- A graduand can complete the entire scheduling process via WhatsApp without human intervention.
- A salesperson can view their personal KPIs and appointment list in the dashboard.
- An admin can launch a mass outreach campaign to 100+ graduands in under 5 minutes.
- All dashboard data updates automatically when the date range is changed, with no page reload.
- Appointment changes in the application are reflected in Google Calendar within 5 seconds.
- The system operates entirely in dark mode with a consistent, premium visual experience.

---

*End of Specification*
