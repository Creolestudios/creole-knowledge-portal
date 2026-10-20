-- Migration: Seed HR Question Bank with Categories
-- Schema: Matches existing public.hr_question_bank table without modifying schema structure.
-- Safe to re-run: Uses ON CONFLICT (category, question_text) DO NOTHING.

INSERT INTO public.hr_question_bank (
  title,
  question_text,
  category,
  difficulty,
  required_skills,
  intent,
  is_mandatory,
  default_order,
  is_active
) VALUES
  -- ============================================================================
  -- 1. MANDATORY SCREENING & HR QUESTIONS
  -- ============================================================================
  ('Self Introduction', 'Please introduce yourself and highlight your most relevant professional experience.', 'hr', 'easy', '["Communication", "Self-Awareness"]'::jsonb, 'Assess candidate introduction, presentation skills, and overview of experience.', true, 1, true),
  ('Role & Company Motivation', 'Why are you interested in this position and what makes you a strong candidate for our team?', 'behavioral', 'easy', '["Motivation", "Culture Fit"]'::jsonb, 'Evaluate candidate interest, role alignment, and enthusiasm.', true, 2, true),
  ('Notice Period & Availability', 'What is your official notice period, current location, and expected availability to join?', 'hr', 'easy', '["Logistics", "Availability"]'::jsonb, 'Verify administrative constraints and notice period.', true, 99, true),
  ('Opportunity Evaluation', 'What are the most important factors you consider when evaluating a new opportunity?', 'hr', 'easy', '["Motivation", "Priorities"]'::jsonb, 'Understand candidate motivations and expectations.', false, 3, true),
  ('Onboarding Support', 'What type of support helps you perform well when starting a new role?', 'hr', 'easy', '["Self-Awareness", "Communication"]'::jsonb, 'Assess onboarding expectations and self-awareness.', false, 4, true),

  -- ============================================================================
  -- 2. BEHAVIORAL
  -- ============================================================================
  ('Challenging Situation', 'Tell us about a challenging professional situation and what you learned from handling it.', 'behavioral', 'medium', '["Reflection", "Judgment"]'::jsonb, 'Assess behavior, ownership, and learning.', false, 1, true),
  ('Constructive Feedback', 'Describe a time you received difficult feedback and how you responded.', 'behavioral', 'medium', '["Receptiveness", "Growth Mindset"]'::jsonb, 'Assess response to feedback.', false, 2, true),
  ('Decision Under Uncertainty', 'Tell us about a decision you made with incomplete information.', 'behavioral', 'medium', '["Decision-Making", "Accountability"]'::jsonb, 'Evaluate judgment under uncertainty.', false, 3, true),
  ('Accountability & Ownership', 'Describe a professional mistake and the steps you took afterward.', 'behavioral', 'medium', '["Accountability", "Learning"]'::jsonb, 'Assess ownership and improvement.', false, 4, true),

  -- ============================================================================
  -- 3. EXPERIENCE OVERVIEW
  -- ============================================================================
  ('Career Journey', 'Walk us through your career journey and the choices that shaped it.', 'experience_overview', 'easy', '["Communication", "Career Overview"]'::jsonb, 'Understand career progression.', false, 1, true),
  ('Preparation from Past Roles', 'Which previous responsibility best prepared you for this position?', 'experience_overview', 'easy', '["Experience", "Relevance"]'::jsonb, 'Connect past experience to the role.', false, 2, true),
  ('Proudest Achievement', 'What achievement from your previous work best represents your capabilities?', 'experience_overview', 'medium', '["Impact", "Communication"]'::jsonb, 'Identify meaningful professional impact.', false, 3, true),
  ('Background Detail', 'Which part of your background would you like us to understand better?', 'experience_overview', 'easy', '["Self-Awareness", "Communication"]'::jsonb, 'Give the candidate space to add context.', false, 4, true),

  -- ============================================================================
  -- 4. ROLE ALIGNMENT
  -- ============================================================================
  ('Role Excitement', 'What interests you most about this role and its responsibilities?', 'role_alignment', 'easy', '["Motivation", "Role Alignment"]'::jsonb, 'Assess interest in the position.', false, 1, true),
  ('Strongest Skill Alignment', 'Which requirement of this role matches your strongest experience?', 'role_alignment', 'easy', '["Role Alignment", "Communication"]'::jsonb, 'Assess requirement alignment.', false, 2, true),
  ('Preparation & Upskilling', 'Which aspect of this role would require the most preparation from you?', 'role_alignment', 'medium', '["Self-Awareness", "Planning"]'::jsonb, 'Identify preparation needs honestly.', false, 3, true),
  ('First 90 Days Success', 'How would you define success in this role during your first few months?', 'role_alignment', 'medium', '["Planning", "Results Orientation"]'::jsonb, 'Assess expectations and role understanding.', false, 4, true),

  -- ============================================================================
  -- 5. PROJECT EXPERIENCE
  -- ============================================================================
  ('Signature Project', 'Tell us about a project you are proud of and your specific contribution.', 'project_experience', 'medium', '["Ownership", "Project Impact"]'::jsonb, 'Measure personal contribution.', false, 1, true),
  ('Project Roadblock Resolution', 'What was the biggest challenge in a recent project, and how did you address it?', 'project_experience', 'medium', '["Problem Solving", "Resilience"]'::jsonb, 'Assess project problem-solving.', false, 2, true),
  ('Project Prioritization', 'How did you decide what to prioritize during a project?', 'project_experience', 'medium', '["Prioritization", "Planning"]'::jsonb, 'Evaluate project organization.', false, 3, true),
  ('Project Retrospective', 'What would you do differently if you repeated one of your previous projects?', 'project_experience', 'medium', '["Reflection", "Continuous Improvement"]'::jsonb, 'Assess learning from project experience.', false, 4, true),

  -- ============================================================================
  -- 6. TEAMWORK & COLLABORATION
  -- ============================================================================
  ('Collaborating Across Styles', 'Describe a time you worked with people who had different working styles.', 'teamwork', 'medium', '["Collaboration", "Adaptability"]'::jsonb, 'Assess collaboration across differences.', false, 1, true),
  ('Status & Communication', 'How do you keep teammates informed when your work affects theirs?', 'teamwork', 'easy', '["Communication", "Collaboration"]'::jsonb, 'Evaluate team communication.', false, 2, true),
  ('Team Role & Contribution', 'What role do you naturally take when working in a team?', 'teamwork', 'easy', '["Self-Awareness", "Teamwork"]'::jsonb, 'Understand team contribution style.', false, 3, true),
  ('Shared Achievement', 'Tell us about a time your team achieved a result together.', 'teamwork', 'medium', '["Collaboration", "Results"]'::jsonb, 'Assess shared ownership.', false, 4, true),

  -- ============================================================================
  -- 7. ADAPTABILITY
  -- ============================================================================
  ('Learning New Tools', 'How do you approach learning an unfamiliar tool, process, or domain?', 'adaptability', 'easy', '["Adaptability", "Learning"]'::jsonb, 'Assess learning agility.', false, 1, true),
  ('Changing Priorities', 'Tell us about a time priorities changed unexpectedly.', 'adaptability', 'medium', '["Adaptability", "Prioritization"]'::jsonb, 'Evaluate response to change.', false, 2, true),
  ('Quality Under Deadlines', 'How do you maintain quality when you must change direction quickly?', 'adaptability', 'medium', '["Quality", "Resilience"]'::jsonb, 'Assess flexibility under pressure.', false, 3, true),
  ('Evolving Processes', 'What is an example of a process or habit you changed after learning something new?', 'adaptability', 'easy', '["Growth Mindset", "Improvement"]'::jsonb, 'Assess continuous improvement.', false, 4, true),

  -- ============================================================================
  -- 8. CONFLICT RESOLUTION
  -- ============================================================================
  ('Handling Disagreements', 'Tell us about a disagreement with a teammate and how you resolved it.', 'conflict_resolution', 'medium', '["Conflict Resolution", "Empathy"]'::jsonb, 'Assess interpersonal judgment.', false, 1, true),
  ('Dissenting Opinions', 'How would you respond if you disagreed with an important decision?', 'conflict_resolution', 'medium', '["Communication", "Professionalism"]'::jsonb, 'Evaluate respectful challenge.', false, 2, true),
  ('Conflict Mediation', 'Describe a time you helped two people reach an agreement.', 'conflict_resolution', 'medium', '["Mediation", "Communication"]'::jsonb, 'Assess conflict mediation.', false, 3, true),
  ('Constructive Escalation', 'What do you do when a disagreement starts affecting team progress?', 'conflict_resolution', 'medium', '["Leadership", "Problem Solving"]'::jsonb, 'Assess constructive escalation.', false, 4, true),

  -- ============================================================================
  -- 9. WORK PREFERENCES
  -- ============================================================================
  ('Productive Environment', 'What type of work environment helps you perform at your best?', 'work_preferences', 'easy', '["Self-Awareness", "Communication"]'::jsonb, 'Understand workplace preferences.', false, 1, true),
  ('Task Organization', 'How do you organize your work when several tasks are competing for attention?', 'work_preferences', 'medium', '["Organization", "Prioritization"]'::jsonb, 'Evaluate work organization.', false, 2, true),
  ('Management Style Fit', 'How do you prefer to receive direction and feedback from a manager?', 'work_preferences', 'easy', '["Communication", "Self-Awareness"]'::jsonb, 'Assess management communication fit.', false, 3, true),
  ('Maintaining Focus', 'How do you maintain focus during repetitive or routine work?', 'work_preferences', 'easy', '["Discipline", "Consistency"]'::jsonb, 'Assess reliability and focus.', false, 4, true),

  -- ============================================================================
  -- 10. CAREER VISION
  -- ============================================================================
  ('Skills to Develop', 'What professional skills would you like to develop over the next few years?', 'career_vision', 'easy', '["Growth Mindset", "Career Planning"]'::jsonb, 'Understand development goals.', false, 1, true),
  ('Career Trajectory Fit', 'How does this role fit into your longer-term career direction?', 'career_vision', 'easy', '["Motivation", "Career Vision"]'::jsonb, 'Assess long-term alignment.', false, 2, true),
  ('Target Responsibilities', 'What kind of responsibility would you like to take on next?', 'career_vision', 'easy', '["Ambition", "Self-Awareness"]'::jsonb, 'Understand career aspirations.', false, 3, true),
  ('Success Definition', 'What would make your next career step successful?', 'career_vision', 'easy', '["Planning", "Results Orientation"]'::jsonb, 'Clarify success criteria.', false, 4, true),

  -- ============================================================================
  -- 11. CULTURE FIT
  -- ============================================================================
  ('Valued Principles', 'What team values are most important to you?', 'culture_fit', 'easy', '["Values", "Self-Awareness"]'::jsonb, 'Understand cultural preferences.', false, 1, true),
  ('Positive Environment', 'How do you contribute to a respectful and positive team environment?', 'culture_fit', 'easy', '["Respect", "Teamwork"]'::jsonb, 'Assess contribution to team culture.', false, 2, true),
  ('Inclusive Perspectives', 'How do you work effectively with people whose perspectives differ from yours?', 'culture_fit', 'medium', '["Inclusion", "Empathy"]'::jsonb, 'Assess inclusive collaboration.', false, 3, true),
  ('Everyday Integrity', 'What does professional integrity mean in everyday work?', 'culture_fit', 'easy', '["Integrity", "Judgment"]'::jsonb, 'Understand professional values.', false, 4, true)

ON CONFLICT (category, question_text) DO NOTHING;
