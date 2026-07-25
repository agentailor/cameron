# Cameron AI

> **The companion finance agent for the [Agentailor](https://blog.agentailor.com) blog — a personal finance agent you own and run yourself. Built in public, one tagged release per article, maturing alongside the agent ecosystem.**

![Demo](docs/images/hero-demo.gif)

_Complete agent workflow: user input → tool approval → execution → streaming response_

[![Release](https://img.shields.io/github/v/release/agentailor/cameron?label=release&color=blue&logo=github)](https://github.com/agentailor/cameron/releases/latest)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-16.2-black?logo=next.js)](https://nextjs.org/)
[![LangGraph](https://img.shields.io/badge/LangGraph.js-1.2-green?logo=langchain)](https://langchain-ai.github.io/langgraphjs/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16+-blue?logo=postgresql)](https://www.postgresql.org/)
[![Drizzle](https://img.shields.io/badge/Drizzle-ORM-C5F74F?logo=drizzle&logoColor=black)](https://orm.drizzle.team/)

---

## What is Cameron?

Cameron is a personal finance agent that tracks spending, manages budgets, watches subscriptions,
ingests receipts and statements, prepares reports, and — over the arc of the series — learns to
build its own capabilities. It's built for two audiences at once:

- the **owner**, who dogfoods it daily on real finances;
- the **reader**, a developer learning agent engineering by running Cameron against seed data.

**Hard rules, never relaxed:**

1. Cameron never moves money or mutates financial records without explicit human approval.
2. Every capability — built-in, skill, connector, or self-written — passes through the same approval gate.
3. All financial data stays on infrastructure the owner controls.

### Built in public, one tag per article

Cameron ships as a linear series of tagged releases — `v1`, `v2`, `v3`, … — one (or two) per
article. A reader learning a given topic checks out the tag for the article that taught it.

The release badge above always points at the current one; whatever it shows is what `main` is.
The series opens with **[`v1`: Cameron is born](https://github.com/agentailor/cameron/releases/tag/v1)** —
the persona and hard rules, a transaction store you own, approval-gated finance tools, and CSV
import. It's the first release where Cameron stops being a generic chat starter and becomes
itself.

> **Seeded from a starter.** The foundation Cameron builds on — the chat loop, streaming,
> persistence, dynamic MCP tool loading, human-in-the-loop approvals, and multi-model support —
> comes from
> [`fullstack-langgraph-nextjs-agent`](https://github.com/agentailor/fullstack-langgraph-nextjs-agent),
> a generic LangGraph.js + Next.js agent starter. That inherited base is referred to as **v0**
> throughout these docs; it is not a Cameron release and carries no `v0` tag — Cameron's own
> history starts at `v1`. The starter keeps its job as the reusable scaffold. Full credit and
> thanks to it.

---

## Need help taking this to production?

I help teams design and optimize LangGraph-based AI agents (RAG, memory, latency, architecture).

If you're building something serious on top of this and want hands-on help:

→ [DM me on LinkedIn](https://www.linkedin.com/in/ali-ibrahim-junior/)

Happy to jump on a short call.

---

## Features (inherited foundation)

The capabilities below come from the starter Cameron is seeded from — the "v0" base described
above. For what `v1` adds on top (persona, transaction store, finance tools, CSV import), see the
[v1 release notes](https://github.com/agentailor/cameron/releases/tag/v1).

### **Dynamic Tool Loading with MCP**

- **Model Context Protocol** integration for dynamic tool management
- Add tools via web UI - no code changes required
- Support for both stdio and HTTP MCP servers
- Tool name prefixing to prevent conflicts

### **Human-in-the-Loop Tool Approval**

- Interactive approval before **mutating** tools run (logging or importing transactions); read-only and MCP tools run without interruption
- Approve or deny each pending action
- Optional auto-approval mode for trusted environments
- Real-time streaming with tool execution pauses

<div align="center">
  <img src="docs/images/tool-approval.png" alt="Tool Approval Dialog" width="600" />
  <p><em>Tool approval dialog with detailed parameter inspection</em></p>
</div>

### **Persistent Conversation Memory**

- LangGraph checkpointer with PostgreSQL backend
- Full conversation history preservation
- Thread-based organization
- Seamless resume across sessions

### **Multimodal File Uploads**

<div align="center">
  <img src="docs/images/file-upload.gif" alt="File upload" width="600" />
  <p><em>Upload images, PDFs, and text files alongside your messages</em></p>
</div>

- Upload images, PDFs, and text files with messages
- S3-compatible storage (MinIO for development)
- Automatic file processing for AI consumption
- Production-ready with AWS S3, Cloudflare R2 support

### **Real-time Streaming Interface**

- Server-Sent Events (SSE) for live responses
- Optimistic UI updates with React Query
- Type-safe message handling
- Error recovery and graceful degradation

### **Persistent Model Settings**

- Provider and model selection saved to `localStorage` automatically
- Settings survive page reloads and thread navigation
- No backend required — zero latency reads on startup

### **LLM Observability with Langfuse**

- End-to-end tracing of agent runs, LLM calls, tool invocations, and token usage
- Works with [Langfuse Cloud](https://cloud.langfuse.com) or a self-hosted instance
- Toggle via `LANGFUSE_ENABLED` env var — zero overhead when disabled
- See [docs/OBSERVABILITY.md](docs/OBSERVABILITY.md) for setup instructions

### **Modern Tech Stack**

- **Frontend**: Next.js 15, React 19, TypeScript, Tailwind CSS
- **Backend**: Node.js, Drizzle ORM, PostgreSQL, MinIO/S3
- **AI**: LangGraph.js, OpenAI/Google/Anthropic models
- **UI**: shadcn/ui components, Lucide icons

## Roadmap

Cameron grows one tagged release at a time. Highlights of what's ahead — see the
[releases page](https://github.com/agentailor/cameron/releases) for what has actually shipped:

| Version | Theme                   | What ships                                                                                                              |
| ------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| _v0_    | Inherited foundation    | Not a Cameron release — the starter's chat loop, streaming, persistence, MCP, HITL approvals.                           |
| **v1**  | Cameron is born         | Persona, transaction store, approval-gated finance tools, CSV import.                                                   |
| **v2**  | Memory                  | Budgets and preferences as long-term memory; summarization of aging history.                                            |
| **v3**  | External data           | A standalone bank MCP server Cameron consumes as a client.                                                              |
| **v4+** | Skills → self-extension | Skills, document ingestion, evals, autonomy, channels, delegation, and eventually Cameron writing its own capabilities. |

## Quick Start

### Prerequisites

- Node.js 18+ and pnpm
- Docker (for PostgreSQL and MinIO)
- OpenAI API key, Google AI API key, or Anthropic API key

### 1. Clone and Install

```bash
git clone https://github.com/agentailor/cameron.git
cd cameron
pnpm install
```

### 2. Environment Setup

```bash
cp .env.example .env.local
```

Edit `.env.local` with your configuration:

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5544/mydb?schema=public"

# AI Models (choose one or more)
OPENAI_API_KEY="sk-..."
GOOGLE_API_KEY="..."
ANTHROPIC_API_KEY="sk-ant-..."

# Optional: Default model
DEFAULT_MODEL="gpt-4o-mini"  # or "gemini-1.5-flash" or "claude-sonnet-4-5"
```

### 3. Start Services

```bash
docker compose up -d  # Starts PostgreSQL and MinIO
```

### 4. Database Setup

```bash
pnpm db:migrate   # apply migrations (or `pnpm db:push` to sync schema in dev)
```

### 5. Run Development Server

```bash
pnpm dev            # serves on http://localhost:3100
# Or override the port
pnpm dev --port=3200
```

Visit [http://localhost:3100](http://localhost:3100) to start chatting with Cameron!

## Screenshots

<table>
  <tr>
    <td align="center">
      <img src="docs/images/chat-interface.png" alt="Chat Interface" width="400" />
      <br /><strong>Main Chat Interface</strong>
      <br />Clean, responsive design with streaming responses
    </td>
    <td align="center">
      <img src="docs/images/mcp-configuration.png" alt="MCP Configuration" width="400" />
      <br /><strong>MCP Server Management</strong>
      <br />Easy setup and configuration of tool servers
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/images/thread-sidebar.png" alt="Thread Management" width="400" />
      <br /><strong>Thread Management</strong>
      <br />Organize conversations with persistent history
    </td>
    <td align="center">
      <img src="docs/images/agent-configuration.png" alt="Streaming Response" width="400" />
      <br /><strong>Agent Configurations</strong>
      <br /> Multiple model Providers Support
    </td>
  </tr>
</table>

## Usage Guide

### Adding MCP Servers

1. **Navigate to Settings** - Click the gear icon in the sidebar
2. **Add MCP Server** - Click "Add MCP Server" button
3. **Configure Server**:
   - **Name**: Unique identifier (e.g., "filesystem")
   - **Type**: Choose `stdio` or `http`
   - **Command**: For stdio servers (e.g., `npx @modelcontextprotocol/server-filesystem`)
   - **Args**: Command arguments (e.g., `["/path/to/allow"]`)
   - **URL**: For HTTP servers

![Add MCP Server](docs/images/add-mcp-server.png)
_MCP server configuration form with example filesystem server setup_

> **Want to build your own MCP server?** Check out [create-mcp-server](https://github.com/agentailor/create-mcp-server) - scaffold production-ready MCP servers in seconds with TypeScript, multiple frameworks (MCP SDK or FastMCP), and built-in debugging tools.

### Example MCP Server Configurations

#### Filesystem Server (stdio)

```json
{
  "name": "filesystem",
  "type": "stdio",
  "command": "npx",
  "args": ["@modelcontextprotocol/server-filesystem", "/Users/yourname/Documents"]
}
```

#### HTTP API Server

```json
{
  "name": "web-api",
  "type": "http",
  "url": "http://localhost:8080/mcp",
  "headers": {
    "Authorization": "Bearer your-token"
  }
}
```

> **Note**: Some HTTP MCP servers require OAuth 2.0 authentication. See [OAuth Documentation](docs/OAUTH.md) for details.

### Tool Approval Workflow

Only **mutating** tools pause for approval (`log_expense`, `import_transactions_csv`); read-only and MCP tools execute directly.

1. **Agent Requests a Mutating Tool** - Cameron proposes a write (e.g. logging a transaction)
2. **Approval Prompt** - Interface shows the tool details and asks for approval
3. **User Decision**:
   - ✅ **Allow**: Execute the tool as requested
   - ❌ **Deny**: Skip execution; Cameron acknowledges nothing was changed
4. **Continue Conversation** - Cameron responds with the tool result

## Architecture

### High-Level Overview

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Next.js UI   │◄──►│  Agent Service   │◄──►│  LangChain      │
│   (React 19)   │    │  (SSE Streaming) │    │ createAgent     │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   React Query   │    │  Repositories    │    │  MCP Clients    │
│   (State Mgmt)  │    │ (Drizzle → PG)   │    │   (Tools)       │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │
                                ▼
                  ┌──────────────────────────────┐
                  │   PostgreSQL  │  MinIO/S3    │
                  │  (Persistence)│ (File Store) │
                  └──────────────────────────────┘
```

### Core Components

#### Agent Factory (`src/lib/agent/index.ts`)

- Builds the agent with LangChain v1's `createAgent` (a prebuilt ReAct agent over LangGraph)
- Installs `humanInTheLoopMiddleware` to gate mutating tools (approval); `approveAllTools` skips it
- Assembles the model (`createChatModel`), built-in + MCP tools, and the system prompt

#### MCP Integration (`src/lib/agent/mcp.ts`)

- Dynamic tool loading from database-stored MCP servers
- Support for stdio and HTTP transports
- Tool name prefixing for conflict prevention

#### Streaming Service (`src/services/agentService.ts`)

- Server-Sent Events for real-time responses
- Message processing and chunk aggregation
- Tool approval workflow handling

#### Chat Hook (`src/hooks/useChatThread.ts`)

- React Query integration for optimistic UI
- Stream management and error handling
- Tool approval user interface

#### File Storage (`src/lib/storage/`)

- S3-compatible storage with MinIO (development) or AWS S3 (production)
- File validation, upload, and content processing for AI
- Multimodal message building with base64 conversion

For detailed architecture documentation, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## API Documentation

The app serves an interactive OpenAPI 3.1 explorer at **`/api-docs`** and the raw spec at
**`/api/openapi`** — generated from per-route Zod schemas. See [docs/API.md](docs/API.md) for how
it works and how to document new routes.

## Development

### Available Scripts

```bash
pnpm dev                 # Start development server with Turbopack
pnpm build              # Production build
pnpm start              # Start production server
pnpm lint               # Run ESLint
pnpm format             # Format with Prettier
pnpm format:check       # Check formatting

# Database (Drizzle)
pnpm db:generate        # Generate a migration after editing schema.ts
pnpm db:migrate         # Apply pending migrations
pnpm db:push            # Push schema directly (dev convenience)
pnpm db:studio          # Open Drizzle Studio (database UI)
```

### Project Structure

```
src/
├── app/                 # Next.js App Router
│   ├── api/            # API routes (stream, upload, mcp-servers)
│   └── thread/         # Thread-specific pages
├── components/         # React components
├── hooks/              # Custom React hooks
├── lib/                # Core utilities
│   ├── agent/          # Agent-related logic
│   └── storage/        # File upload & S3 utilities
├── lib/
│   ├── database/       # Drizzle schema.ts + db.ts client
│   └── repositories/   # DB access seam (thread + mcpServer repositories)
├── services/           # Business logic
└── types/              # TypeScript definitions

drizzle.config.ts       # Drizzle Kit config (schema path, migrations dir)
```

### Key Files

- **Agent Configuration**: `src/lib/agent/index.ts`, `src/lib/agent/mcp.ts`
- **Agent Persona**: `src/lib/agent/prompt.ts`
- **API Endpoints**: `src/app/api/agent/stream/route.ts`, `src/app/api/agent/upload/route.ts`
- **File Storage**: `src/lib/storage/` (validation, upload, content processing)
- **Database**: `src/lib/database/schema.ts` (Drizzle schema), `src/lib/repositories/` (access seam)
- **Main Chat Interface**: `src/components/Thread.tsx`, `src/components/MessageInput.tsx`
- **Streaming Logic**: `src/hooks/useChatThread.ts`

## Contributing

Contributions and issues are welcome — Cameron is developed in the open.

### Getting Started

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes
4. Commit: `git commit -m 'Add amazing feature'`
5. Push: `git push origin feature/amazing-feature`
6. Open a Pull Request

### Development Guidelines

- Follow TypeScript strict mode
- Use Prettier for formatting
- Add JSDoc comments for public APIs
- Test MCP server integrations thoroughly
- Update documentation for new features

## Learning Resources

### LangGraph.js

- [LangGraph.js Documentation](https://langchain-ai.github.io/langgraphjs/)
- [StateGraph API Reference](https://langchain-ai.github.io/langgraphjs/reference/modules/langgraph.html)
- [Checkpointer Guide](https://langchain-ai.github.io/langgraphjs/how-tos/persistence-postgres)

### Model Context Protocol (MCP)

- [MCP Specification](https://spec.modelcontextprotocol.io/)
- [MCP Servers Repository](https://github.com/modelcontextprotocol/servers)
- [Building MCP Servers](https://modelcontextprotocol.io/docs/building-servers)
- [Docker MCP Catalog](https://blog.agentailor.com/posts/docker-mcp-catalog-and-toolkit?utm_source=github_cameron_repo)

### Next.js & React

- [Next.js 15 Documentation](https://nextjs.org/docs)
- [React 19 Release Notes](https://react.dev/blog/2024/12/05/react-19)
- [React Query (TanStack Query)](https://tanstack.com/query/latest)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [`fullstack-langgraph-nextjs-agent`](https://github.com/agentailor/fullstack-langgraph-nextjs-agent) — the starter Cameron's v0 foundation is seeded from
- [LangChain](https://github.com/langchain-ai) for the incredible AI framework
- [Model Context Protocol](https://modelcontextprotocol.io/) for the tool integration standard
- [Next.js](https://nextjs.org/) team for the amazing React framework

---

**Follow Cameron as it grows, one release at a time.**

[Get Started](#quick-start)

---

If this repo helped you and you’d like guidance implementing it in production, feel free to reach out on [LinkedIn](https://www.linkedin.com/in/ali-ibrahim-junior/).
