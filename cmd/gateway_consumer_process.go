package cmd

import (
	"context"
	"fmt"
	"strings"

	"github.com/nextlevelbuilder/goclaw/internal/agent"
	"github.com/nextlevelbuilder/goclaw/internal/config"
	"github.com/nextlevelbuilder/goclaw/internal/scheduler"
)

// makeSchedulerRunFunc creates the RunFunc for the scheduler.
// It extracts the agentID from the session key and routes to the correct agent loop.
func makeSchedulerRunFunc(agents *agent.Router, cfg *config.Config) scheduler.RunFunc {
	return func(ctx context.Context, req agent.RunRequest) (*agent.RunResult, error) {
		// Extract agentID from session key (format: agent:{agentId}:{rest})
		agentID := cfg.ResolveDefaultAgentID()
		if parts := strings.SplitN(req.SessionKey, ":", 3); len(parts) >= 2 && parts[0] == "agent" {
			agentID = parts[1]
		}

		loop, err := agents.Get(agentID)
		if err != nil {
			return nil, fmt.Errorf("agent %s not found: %w", agentID, err)
		}
		return loop.Run(ctx, req)
	}
}
