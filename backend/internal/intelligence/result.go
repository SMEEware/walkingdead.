package intelligence

import (
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"
)

func validate(content string, supplied map[string]bool) (Result, error) {
	var analysis struct {
		Summary  string `json:"summary"`
		Findings []struct {
			Kind        string   `json:"kind"`
			Title       string   `json:"title"`
			Assessment  string   `json:"assessment"`
			EvidenceIDs []string `json:"evidenceIds"`
			Confidence  string   `json:"confidence"`
		} `json:"findings"`
		Limitations []string `json:"limitations"`
	}
	content = strings.TrimSpace(content)
	if fenced, ok := strings.CutPrefix(content, "```"); ok {
		fenced = strings.TrimPrefix(fenced, "json")
		content = strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(fenced), "```"))
	}
	decoder := json.NewDecoder(strings.NewReader(content))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&analysis) != nil || decoder.Decode(new(any)) != io.EOF || !validText(analysis.Summary, 1600) || len(analysis.Findings) < 1 {
		return Result{}, ErrInvalidResponse
	}
	analysis.Findings = analysis.Findings[:min(len(analysis.Findings), 6)]
	analysis.Limitations = analysis.Limitations[:min(len(analysis.Limitations), 8)]
	result := Result{Text: analysis.Summary, Findings: make([]Finding, 0, len(analysis.Findings)), Limitations: make([]string, 0, len(analysis.Limitations)+1)}
	for _, finding := range analysis.Findings {
		finding.Kind = strings.ToLower(strings.TrimSpace(finding.Kind))
		finding.Confidence = strings.ToLower(strings.TrimSpace(finding.Confidence))
		if !slices.Contains([]string{"observation", "inference"}, finding.Kind) || !validText(finding.Title, 160) || !validText(finding.Assessment, 1600) || !slices.Contains([]string{"low", "medium", "high"}, finding.Confidence) {
			return Result{}, ErrInvalidResponse
		}
		grounded := []string{}
		for _, id := range finding.EvidenceIDs {
			if supplied[id] && !slices.Contains(grounded, id) {
				grounded = append(grounded, id)
			}
		}
		if len(grounded) == 0 || 2*len(grounded) < len(finding.EvidenceIDs) {
			return Result{}, ErrInvalidResponse
		}
		finding.EvidenceIDs = grounded[:min(len(grounded), 12)]
		prefix := "Observation: "
		if finding.Kind == "inference" {
			prefix = "Inference: "
		}
		result.Findings = append(result.Findings, Finding{Title: strings.TrimSpace(finding.Title), Assessment: prefix + strings.TrimSpace(finding.Assessment), EvidenceIDs: finding.EvidenceIDs, Confidence: finding.Confidence})
	}
	for _, limitation := range analysis.Limitations {
		if !validText(limitation, 400) {
			return Result{}, ErrInvalidResponse
		}
		result.Limitations = append(result.Limitations, strings.TrimSpace(limitation))
	}
	return result, nil
}

var markupTag = regexp.MustCompile(`<\s*[A-Za-z/!?]`)

// validText accepts shell redirections such as ">>" but no HTML-like markup.
func validText(value string, limit int) bool {
	return strings.TrimSpace(value) != "" && len(value) <= limit && utf8.ValidString(value) && !markupTag.MatchString(value) && !strings.ContainsFunc(value, func(r rune) bool { return unicode.IsControl(r) && r != '\n' && r != '\t' })
}

func render(result Result) string {
	var output strings.Builder
	output.WriteString(markdown(result.Text))
	for _, finding := range result.Findings {
		fmt.Fprintf(&output, "\n\n### %s\n\n%s\n\nConfidence: %s. Evidence: %s.", markdown(finding.Title), markdown(finding.Assessment), finding.Confidence, strings.Join(finding.EvidenceIDs, ", "))
	}
	output.WriteString("\n\n### Limitations\n")
	for _, limitation := range result.Limitations {
		fmt.Fprintf(&output, "\n- %s", markdown(limitation))
	}
	return output.String()
}

func markdown(value string) string {
	return strings.NewReplacer("\\", "\\\\", "`", "\\`", "*", "\\*", "_", "\\_", "{", "\\{", "}", "\\}", "[", "\\[", "]", "\\]", "(", "\\(", ")", "\\)", "#", "\\#", "+", "\\+", "-", "\\-", "!", "\\!", "|", "\\|").Replace(strings.TrimSpace(value))
}
