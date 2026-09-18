# AI Fitness Coach

AI Fitness Coach is a full-stack fitness tracking and AI coaching application built as a production-oriented software and LLM engineering project.

Instead of acting as a generic chatbot, the AI Coach can reason over structured user fitness data through controlled backend tools. The application combines traditional full-stack engineering, deterministic analytics, and LLM tool calling to provide personalized, evidence-aware fitness coaching.

## Current Capabilities

- User registration and login with JWT authentication and bcrypt password hashing
- Protected fitness profile management
- Weight check-ins with deterministic weight-history analytics
- Daily nutrition tracking for calories and macronutrients
- Daily activity tracking for steps, walking distance, and active calories
- Workout session tracking for strength, cardio, mobility, sport, and other training
- Structured AI Coach responses
- Read-only AI tool calling over authenticated user data
- Multi-domain AI reasoning across profile, weight, nutrition, activity, and workouts
- Runtime validation with Zod across API and AI boundaries

## Architecture

The backend follows a layered architecture:

```text
Client
  ↓
Express Routes
  ↓
Controllers
  ↓
Services
  ↓
Prisma ORM
  ↓
PostgreSQL
```

The AI subsystem sits on top of the existing application services rather than accessing the database directly:

```text
User Request
    ↓
AI Coach API
    ↓
AI Orchestrator
    ↓
Model Provider
    ↓
Tool Calls
    ↓
Tool Registry
    ↓
Domain Services
    ↓
Prisma ORM
    ↓
PostgreSQL
```

This keeps authentication, authorization, business rules, and deterministic calculations under backend control while allowing the language model to interpret safe application data.

## AI Coach

The AI Coach uses:

- Model-provider abstraction
- Structured model outputs
- Controlled tool calling
- Zod-validated tool arguments
- Authenticated execution context
- Multi-tool orchestration

The current provider implementation uses the OpenAI Responses API while keeping provider-specific behavior isolated from the rest of the application.

The model never receives direct database access.

### Current Read-Only AI Tools

- `getUserProfile`
- `getWeightHistory`
- `getNutritionHistory`
- `getActivityHistory`
- `getWorkoutHistory`

The AI can select and combine these tools depending on the user's question.

For example, an overall progress question can combine:

```text
Fitness Goal
     ↓
Weight History
     ↓
Nutrition
     ↓
Daily Activity
     ↓
Workout History
     ↓
AI Interpretation
```

This allows the coach to reason across multiple fitness domains while keeping factual data retrieval and calculations inside trusted backend services.

## AI Trust Boundary

The model does not control user identity.

```text
Model
  ↓
Chooses an allowed tool
  ↓
Zod validates tool arguments
  ↓
Backend injects authenticated userId
  ↓
Domain Service
  ↓
Authorized user data
  ↓
Model interprets safe result
```

The model may choose arguments such as:

```text
days = 30
```

but it cannot choose:

```text
userId
```

The authenticated identity comes from the backend JWT context.

Deterministic calculations such as averages, totals, and weight changes are also performed by backend services rather than delegated to the language model.

## Fitness Data Model

### Fitness Profile

Stores the user's current fitness context and goals.

### Weight Check-ins

Historical weight records used for weight-history calculations and trend analysis.

### Nutrition Entries

Daily nutrition aggregates containing:

- Calories
- Protein
- Carbohydrates
- Fat

### Daily Activity

Daily movement records containing:

- Steps
- Walking distance
- Active calories
- Activity source
- Recorded timestamp

The activity model is designed to support manual tracking now and future Apple Health / Health Connect synchronization.

### Workout Sessions

Workouts are modeled as events rather than daily aggregates.

This allows multiple workouts to exist on the same day.

Each workout currently stores:

- Training type
- Duration
- Optional notes
- Recorded timestamp

Supported training types include:

- Strength
- Cardio
- Mobility
- Sport
- Other

Exercise-level sets, reps, loads, personal records, and progressive-overload analytics are intentionally outside the current V1 scope.

## Deterministic Analytics

Fitness calculations are performed by backend services before data reaches the LLM.

Examples include:

### Weight

- Starting weight
- Latest weight
- Total weight change
- Average weekly change
- Number of check-ins

### Nutrition

- Average calories
- Average protein
- Average carbohydrates
- Average fat
- Logged days
- Latest nutrition values

### Activity

- Average steps
- Total steps
- Average walking distance
- Average active calories
- Logged activity days
- Latest step count

### Workouts

- Total sessions
- Total training minutes
- Average workout duration
- Sessions by training type
- Latest workout type
- Latest workout duration
- Latest workout timestamp

The LLM interprets these facts instead of performing the underlying calculations itself.

## Validation and Security

TypeScript provides compile-time type safety, while Zod validates untrusted data crossing runtime boundaries.

```text
Untrusted Request
      ↓
JWT Authentication
      ↓
Runtime Validation
      ↓
Business / Ownership Rules
      ↓
Prisma ORM
      ↓
PostgreSQL Constraints
```

Important security principles include:

- Password hashes are not returned in normal API responses
- Authenticated identity is not accepted from request bodies
- AI tools cannot supply their own `userId`
- Cross-user resource access is blocked through ownership-aware operations
- AI tools use an explicit allow-list registry
- AI tool arguments are validated with Zod
- Structured model output is validated before being returned to the client
- Sensitive API keys and JWTs are not exposed to the model

## Evidence-Aware AI Behavior

The AI Coach is designed to distinguish between available evidence and unsupported conclusions.

For example:

```text
6 logged strength sessions
```

supports:

```text
"You logged 6 strength sessions."
```

but does not automatically support:

```text
"Your strength is improving."
```

Objective strength progression would require additional information such as exercises, sets, reps, and loads.

Similarly:

- Missing activity data is not treated as zero activity
- Missing workouts are not automatically treated as rest days
- Sparse history is acknowledged instead of converted into long-term trends
- User-entered workout notes are treated as contextual information rather than independently verified measurements

## Technology Stack

### Frontend

- React 19
- TypeScript
- Vite
- React Router

### Backend

- Node.js
- Express 5
- TypeScript
- Zod
- JWT
- bcrypt

### Database

- PostgreSQL
- Prisma ORM
- Docker

### AI

- OpenAI Node SDK
- Responses API
- Structured outputs
- Model-provider abstraction
- Tool calling
- Zod-validated tool arguments
- Multi-tool orchestration

### Infrastructure

- Docker
- Docker Compose
- Nginx planned
- AWS deployment planned

## Repository Structure

```text
fitness-ai-coach/
│
├── frontend/
│   └── React + TypeScript application
│
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations/
│   │
│   └── src/
│       ├── middleware/
│       ├── modules/
│       │   ├── auth/
│       │   ├── profile/
│       │   ├── checkins/
│       │   ├── nutrition/
│       │   ├── activity/
│       │   ├── workouts/
│       │   └── ai/
│       ├── types/
│       └── server.ts
│
├── nginx/
├── database/
├── docs/
└── docker-compose.yml
```

## Development Principles

The project separates three major responsibilities:

### 1. Application Backend

Responsible for:

- Authentication
- Authorization
- Data integrity
- Business logic
- Ownership rules
- Deterministic calculations

### 2. AI Tools

Responsible for exposing narrowly scoped, validated capabilities over existing application services.

AI tools do not bypass the normal application architecture.

### 3. Language Model

Responsible for interpreting available evidence and producing user-facing coaching responses.

This architecture makes AI a controlled component of the product rather than giving the model unrestricted access to application state.

## Current Project Status

Completed backend verticals:

- Authentication
- Fitness Profile
- Weight Tracking
- Weight Analytics
- Weight AI Tool
- Nutrition Tracking
- Nutrition Analytics
- Nutrition AI Tool
- Activity Tracking
- Activity Analytics
- Activity AI Tool
- Workout Tracking
- Workout Analytics
- Workout AI Tool
- Structured AI Coach Responses
- Multi-Tool AI Orchestration

The AI Coach can currently reason across five application domains:

```text
Profile
Weight
Nutrition
Activity
Workout
```

The frontend contains the main application routes and shared layout, while deeper frontend/backend integration is still in progress.

## Roadmap

### Near-Term

- Connect the frontend to authenticated backend APIs
- Build user-facing fitness tracking workflows
- Build the frontend AI Coach experience
- Add progress and photo workflows
- Add automated testing
- Improve production security and error handling
- Add AI evaluation and observability
- Add a small vetted fitness-knowledge retrieval layer (RAG)
- Deploy the application

### Future Enhancements

- Apple HealthKit integration
- Android Health Connect integration
- Exercise-level tracking
- Sets, reps, and load tracking
- Progressive-overload analytics
- More advanced AI memory and personalization

## Project Goal

The goal of AI Fitness Coach is not to build a thin chatbot wrapper.

The project explores how a production application can combine:

```text
Structured Product Data
        +
Secure Backend Services
        +
Deterministic Analytics
        +
Controlled LLM Tool Calling
        +
AI Reasoning
```

to create a fitness coach that can reason over real user data while keeping important application logic, security boundaries, and factual calculations under backend control.
