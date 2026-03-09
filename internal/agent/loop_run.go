package agent

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/nextlevelbuilder/goclaw/internal/store"
	"github.com/nextlevelbuilder/goclaw/internal/tools"
	"github.com/nextlevelbuilder/goclaw/internal/tracing"
	"github.com/nextlevelbuilder/goclaw/pkg/protocol"
)

// Run processes a single message through the agent loop.
// It blocks until completion and returns the final response.
func (l *Loop) Run(ctx context.Context, req RunRequest) (*RunResult, error) {
	l.activeRuns.Add(1)
	defer l.activeRuns.Add(-1)

	// Per-run emit wrapper: enriches every AgentEvent with delegation + routing context.
	emitRun := func(event AgentEvent) {
		event.RunKind = req.RunKind
		event.DelegationID = req.DelegationID
		event.TeamID = req.TeamID
		event.TeamTaskID = req.TeamTaskID
		event.ParentAgentID = req.ParentAgentID
		event.UserID = req.UserID
		event.Channel = req.Channel
		event.ChatID = req.ChatID
		l.emit(event)
	}

	emitRun(AgentEvent{
		Type:    protocol.AgentEventRunStarted,
		AgentID: l.id,
		RunID:   req.RunID,
		Payload: map[string]interface{}{"message": req.Message},
	})

	// Create trace
	var traceID uuid.UUID
	isChildTrace := req.ParentTraceID != uuid.Nil && l.traceCollector != nil

	if isChildTrace {
		// Announce run: reuse parent trace, don't create new trace record.
		// Spans will be added to the parent trace with proper nesting.
		traceID = req.ParentTraceID
		ctx = tracing.WithTraceID(ctx, traceID)
		ctx = tracing.WithCollector(ctx, l.traceCollector)
		ctx = tracing.WithParentSpanID(ctx, store.GenNewID())
		if req.ParentRootSpanID != uuid.Nil {
			ctx = tracing.WithAnnounceParentSpanID(ctx, req.ParentRootSpanID)
		}
	} else if l.traceCollector != nil {
		traceID = store.GenNewID()
		now := time.Now().UTC()
		traceName := "chat " + l.id
		if req.TraceName != "" {
			traceName = req.TraceName
		}
		trace := &store.TraceData{
			ID:           traceID,
			RunID:        req.RunID,
			SessionKey:   req.SessionKey,
			UserID:       req.UserID,
			Channel:      req.Channel,
			Name:         traceName,
			InputPreview: truncateStr(req.Message, 500),
			Status:       store.TraceStatusRunning,
			StartTime:    now,
			CreatedAt:    now,
			Tags:         req.TraceTags,
		}
		if l.agentUUID != uuid.Nil {
			trace.AgentID = &l.agentUUID
		}
		// Link to parent trace if this is a delegated run
		if delegateParent := tracing.DelegateParentTraceIDFromContext(ctx); delegateParent != uuid.Nil {
			trace.ParentTraceID = &delegateParent
		}
		if err := l.traceCollector.CreateTrace(ctx, trace); err != nil {
			slog.Warn("tracing: failed to create trace", "error", err)
		} else {
			ctx = tracing.WithTraceID(ctx, traceID)
			ctx = tracing.WithCollector(ctx, l.traceCollector)

			// Pre-generate root "agent" span ID so LLM/tool spans can reference it as parent.
			// The span itself is emitted after runLoop completes (with full timing data).
			ctx = tracing.WithParentSpanID(ctx, store.GenNewID())
		}
	}

	// Inject local key into tool context so delegation/subagent tools can
	// propagate topic/thread routing info back through announce messages.
	if req.LocalKey != "" {
		ctx = tools.WithToolLocalKey(ctx, req.LocalKey)
	}

	runStart := time.Now().UTC()
	result, err := l.runLoop(ctx, req)

	// Emit root "agent" span with full timing (parent for all LLM/tool spans).
	if l.traceCollector != nil && traceID != uuid.Nil {
		l.emitAgentSpan(ctx, runStart, result, err)
	}

	if err != nil {
		emitRun(AgentEvent{
			Type:    protocol.AgentEventRunFailed,
			AgentID: l.id,
			RunID:   req.RunID,
			Payload: map[string]string{"error": err.Error()},
		})
		// Only finish trace for root runs; child traces don't own the trace lifecycle.
		// Use background context when the run context is cancelled (/stop command)
		// so the DB update still succeeds.
		if !isChildTrace && l.traceCollector != nil && traceID != uuid.Nil {
			traceCtx := ctx
			traceStatus := store.TraceStatusError
			if ctx.Err() != nil {
				traceCtx = context.Background()
				traceStatus = store.TraceStatusCancelled
			}
			l.traceCollector.FinishTrace(traceCtx, traceID, traceStatus, err.Error(), "")
		}
		return nil, err
	}

	emitRun(AgentEvent{
		Type:    protocol.AgentEventRunCompleted,
		AgentID: l.id,
		RunID:   req.RunID,
		Payload: map[string]interface{}{"content": result.Content},
	})
	if !isChildTrace && l.traceCollector != nil && traceID != uuid.Nil {
		l.traceCollector.FinishTrace(ctx, traceID, store.TraceStatusCompleted, "", truncateStr(result.Content, 500))
	}
	return result, nil
}
