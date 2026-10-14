import { useId, useState } from 'react';
import { Plus, X } from 'lucide-react';
import {
  employmentTypeSchema,
  lookupSkill,
  newId,
  normalizeSkillName,
  skillCategorySchema,
  workArrangementSchema,
  type Certification,
  type Education,
  type Experience,
  type ProfileContent,
  type Project,
  type SkillCategory,
} from '@applypilot/shared';
import { Button } from '../../components/ui/button';
import { Card, CardDescription, CardTitle } from '../../components/ui/card';
import { Field, Input, Select, Textarea } from '../../components/ui/field';
import { EntryList } from './entry-list';
import { formatDateRange, formatPartialDate } from './format';
import { ListInput } from './list-input';
import type { FieldErrors } from './validation';

const CATEGORY_LABELS: Record<SkillCategory, string> = {
  language: 'Language',
  framework: 'Framework',
  cloud: 'Cloud',
  devops: 'DevOps',
  data: 'Data',
  tool: 'Tool',
  practice: 'Practice',
  professional: 'Professional',
  'spoken-language': 'Spoken language',
  other: 'Other',
};

const DATE_HINT = 'YYYY or YYYY-MM';

type Update<T> = (patch: Partial<T>) => void;

function DateFields<T extends { startDate: string; endDate: string; current: boolean }>({
  item,
  update,
  errorFor,
  currentLabel,
  idPrefix,
}: {
  item: T;
  update: Update<T>;
  errorFor: (field: string) => string | undefined;
  currentLabel: string;
  idPrefix: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field id={`${idPrefix}-start`} label="Start" hint={DATE_HINT} error={errorFor('startDate')}>
        {(props) => (
          <Input
            {...props}
            value={item.startDate}
            placeholder="2024-05"
            onChange={(e) => update({ startDate: e.target.value.trim() } as Partial<T>)}
          />
        )}
      </Field>
      <Field
        id={`${idPrefix}-end`}
        label={item.current ? 'Expected end' : 'End'}
        hint={DATE_HINT}
        error={errorFor('endDate')}
      >
        {(props) => (
          <Input
            {...props}
            value={item.endDate}
            placeholder="2025-08"
            onChange={(e) => update({ endDate: e.target.value.trim() } as Partial<T>)}
          />
        )}
      </Field>
      <label className="col-span-2 flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={item.current}
          onChange={(e) => update({ current: e.target.checked } as Partial<T>)}
        />
        {currentLabel}
      </label>
    </div>
  );
}

function PersonalSection({ value, onChange, errors }: SectionProps<ProfileContent['personal']>) {
  const id = useId();
  const field = (
    key: keyof ProfileContent['personal'],
    label: string,
    type = 'text',
    placeholder = '',
  ) => (
    <Field id={`${id}-${key}`} label={label} error={errors[`personal.${key}`]}>
      {(props) => (
        <Input
          {...props}
          type={type}
          value={value[key]}
          placeholder={placeholder}
          onChange={(e) => onChange({ ...value, [key]: e.target.value })}
        />
      )}
    </Field>
  );
  return (
    <Card className="space-y-3" role="region" aria-label="Personal details">
      <CardTitle>Personal details</CardTitle>
      <div className="grid gap-2">
        {field('fullName', 'Full name')}
        {field('email', 'Email', 'email')}
        <div className="grid grid-cols-2 gap-2">
          {field('phone', 'Phone', 'tel')}
          {field('location', 'Location', 'text', 'City, Province')}
        </div>
        {field('linkedinUrl', 'LinkedIn', 'url', 'https://linkedin.com/in/…')}
        {field('githubUrl', 'GitHub', 'url', 'https://github.com/…')}
        {field('portfolioUrl', 'Portfolio or website', 'url', 'https://…')}
      </div>
    </Card>
  );
}

interface SectionProps<T> {
  value: T;
  onChange: (value: T) => void;
  errors: FieldErrors;
}

function SkillsSection({ value, onChange }: SectionProps<ProfileContent['skills']>) {
  const id = useId();
  const [name, setName] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const add = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (value.some((skill) => normalizeSkillName(skill.name) === normalizeSkillName(trimmed))) {
      setMessage(`${trimmed} is already in your skills.`);
      return;
    }
    const known = lookupSkill(trimmed);
    onChange([...value, { id: newId(), name: trimmed, category: known?.category ?? 'other' }]);
    setName('');
    setMessage(null);
  };

  return (
    <Card className="space-y-3" role="region" aria-label="Skills">
      <div>
        <CardTitle>
          Skills <span className="font-normal text-muted">({value.length})</span>
        </CardTitle>
        <CardDescription>
          Only list skills you can talk about in an interview. The order here is the order matching
          treats as most important.
        </CardDescription>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <label htmlFor={`${id}-new`} className="sr-only">
          New skill
        </label>
        <Input
          id={`${id}-new`}
          value={name}
          placeholder="Add a skill, e.g. Terraform"
          onChange={(e) => setName(e.target.value)}
        />
        <Button size="sm" type="submit" variant="secondary" disabled={!name.trim()}>
          <Plus aria-hidden className="h-3.5 w-3.5" /> Add
        </Button>
      </form>
      {message ? (
        <p role="status" className="text-[11px] text-muted">
          {message}
        </p>
      ) : null}
      {value.length === 0 ? <p className="text-xs text-muted">No skills yet.</p> : null}
      <ul className="space-y-1.5">
        {value.map((skill) => (
          <li key={skill.id} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm">{skill.name}</span>
            <label htmlFor={`${id}-${skill.id}`} className="sr-only">
              Category for {skill.name}
            </label>
            <Select
              id={`${id}-${skill.id}`}
              className="w-32 text-xs"
              value={skill.category}
              onChange={(e) =>
                onChange(
                  value.map((s) =>
                    s.id === skill.id
                      ? { ...s, category: skillCategorySchema.parse(e.target.value) }
                      : s,
                  ),
                )
              }
            >
              {skillCategorySchema.options.map((category) => (
                <option key={category} value={category}>
                  {CATEGORY_LABELS[category]}
                </option>
              ))}
            </Select>
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Remove ${skill.name}`}
              onClick={() => onChange(value.filter((s) => s.id !== skill.id))}
            >
              <X aria-hidden className="h-3.5 w-3.5" />
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const EMPLOYMENT_LABELS: Record<string, string> = {
  'full-time': 'Full-time',
  'part-time': 'Part-time',
  contract: 'Contract',
  temporary: 'Temporary',
  internship: 'Internship',
  volunteer: 'Volunteer',
  other: 'Other',
};

function toggle<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

function PreferencesSection({
  value,
  onChange,
  errors,
}: SectionProps<ProfileContent['preferences']>) {
  const id = useId();
  return (
    <Card className="space-y-3" role="region" aria-label="Job preferences">
      <div>
        <CardTitle>Job preferences</CardTitle>
        <CardDescription>
          Used for the "Job preferences" part of the match score. Leave blank to skip it.
        </CardDescription>
      </div>
      <fieldset className="space-y-1">
        <legend className="text-xs font-medium">Work arrangement</legend>
        <div className="flex flex-wrap gap-3">
          {workArrangementSchema.options.map((option) => (
            <label key={option} className="flex items-center gap-1.5 text-xs capitalize">
              <input
                type="checkbox"
                checked={value.workArrangements.includes(option)}
                onChange={() =>
                  onChange({ ...value, workArrangements: toggle(value.workArrangements, option) })
                }
              />
              {option}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-1">
        <legend className="text-xs font-medium">Employment type</legend>
        <div className="flex flex-wrap gap-3">
          {employmentTypeSchema.options.map((option) => (
            <label key={option} className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={value.employmentTypes.includes(option)}
                onChange={() =>
                  onChange({ ...value, employmentTypes: toggle(value.employmentTypes, option) })
                }
              />
              {EMPLOYMENT_LABELS[option]}
            </label>
          ))}
        </div>
      </fieldset>
      <Field
        id={`${id}-roles`}
        label="Desired roles"
        hint="Comma-separated"
        error={errors['preferences.desiredRoles']}
      >
        {(props) => (
          <ListInput
            {...props}
            variant="comma"
            value={value.desiredRoles}
            placeholder="Cloud Engineering Intern, IT Support"
            onChange={(desiredRoles) => onChange({ ...value, desiredRoles })}
          />
        )}
      </Field>
      <Field
        id={`${id}-locations`}
        label="Preferred locations"
        hint="Comma-separated cities. Remote roles always fit."
        error={errors['preferences.locations']}
      >
        {(props) => (
          <ListInput
            {...props}
            variant="comma"
            value={value.locations}
            placeholder="Toronto, Waterloo"
            onChange={(locations) => onChange({ ...value, locations })}
          />
        )}
      </Field>
      <Field
        id={`${id}-salary`}
        label="Salary expectation (optional)"
        error={errors['preferences.salaryExpectation']}
      >
        {(props) => (
          <Input
            {...props}
            value={value.salaryExpectation}
            placeholder="$25/hour"
            onChange={(e) => onChange({ ...value, salaryExpectation: e.target.value })}
          />
        )}
      </Field>
    </Card>
  );
}

const emptyEducation = (): Education => ({
  id: newId(),
  institution: '',
  degree: '',
  field: '',
  startDate: '',
  endDate: '',
  current: false,
  gpa: '',
  coursework: [],
});
const emptyExperience = (): Experience => ({
  id: newId(),
  employer: '',
  position: '',
  location: '',
  startDate: '',
  endDate: '',
  current: false,
  bullets: [],
  technologies: [],
});
const emptyCertification = (): Certification => ({
  id: newId(),
  name: '',
  issuer: '',
  date: '',
  credentialUrl: '',
});
const emptyProject = (): Project => ({
  id: newId(),
  name: '',
  description: '',
  technologies: [],
  url: '',
  bullets: [],
});

/**
 * Controlled editor for a whole profile. Used both for the saved profile and
 * for reviewing a parsed resume draft before anything is saved.
 */
export function ProfileEditor({
  value,
  onChange,
  errors,
  showPreferences = true,
}: {
  value: ProfileContent;
  onChange: (value: ProfileContent) => void;
  errors: FieldErrors;
  showPreferences?: boolean;
}) {
  const id = useId();
  const set =
    <K extends keyof ProfileContent>(key: K) =>
    (next: ProfileContent[K]) =>
      onChange({ ...value, [key]: next });

  return (
    <div className="space-y-3">
      <PersonalSection value={value.personal} onChange={set('personal')} errors={errors} />

      <Card className="space-y-2" role="region" aria-label="Summary">
        <Field
          id={`${id}-summary`}
          label="Summary"
          hint="Two or three sentences, in your own words."
          error={errors.summary}
        >
          {(props) => (
            <Textarea
              {...props}
              value={value.summary}
              rows={3}
              onChange={(e) => set('summary')(e.target.value)}
            />
          )}
        </Field>
      </Card>

      <EntryList
        title="Education"
        path="education"
        addLabel="Add"
        emptyText="No education yet."
        items={value.education}
        onChange={set('education')}
        create={emptyEducation}
        errors={errors}
        summary={(e) => ({
          primary: [e.degree, e.field].filter(Boolean).join(', ') || e.institution,
          secondary: [
            e.degree || e.field ? e.institution : '',
            formatDateRange(e.startDate, e.endDate, e.current, 'In progress'),
          ]
            .filter(Boolean)
            .join(' · '),
        })}
        renderForm={(e, update, errorFor) => (
          <>
            <Field id={`${id}-${e.id}-inst`} label="School" error={errorFor('institution')}>
              {(p) => (
                <Input
                  {...p}
                  value={e.institution}
                  onChange={(ev) => update({ institution: ev.target.value })}
                />
              )}
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field id={`${id}-${e.id}-deg`} label="Degree" error={errorFor('degree')}>
                {(p) => (
                  <Input
                    {...p}
                    value={e.degree}
                    placeholder="Bachelor of Science"
                    onChange={(ev) => update({ degree: ev.target.value })}
                  />
                )}
              </Field>
              <Field id={`${id}-${e.id}-field`} label="Field of study" error={errorFor('field')}>
                {(p) => (
                  <Input
                    {...p}
                    value={e.field}
                    placeholder="Computer Science"
                    onChange={(ev) => update({ field: ev.target.value })}
                  />
                )}
              </Field>
            </div>
            <DateFields
              item={e}
              update={update}
              errorFor={errorFor}
              currentLabel="I'm currently studying here"
              idPrefix={`${id}-${e.id}`}
            />
            <Field id={`${id}-${e.id}-gpa`} label="GPA (optional)" error={errorFor('gpa')}>
              {(p) => (
                <Input
                  {...p}
                  value={e.gpa}
                  placeholder="3.7/4.0"
                  onChange={(ev) => update({ gpa: ev.target.value })}
                />
              )}
            </Field>
            <Field
              id={`${id}-${e.id}-courses`}
              label="Relevant coursework"
              hint="Comma-separated"
              error={errorFor('coursework')}
            >
              {(p) => (
                <ListInput
                  {...p}
                  variant="comma"
                  value={e.coursework}
                  onChange={(coursework) => update({ coursework })}
                />
              )}
            </Field>
          </>
        )}
      />

      <EntryList
        title="Experience"
        path="experience"
        addLabel="Add"
        emptyText="No experience yet. Part-time jobs, internships and volunteer roles all count."
        items={value.experience}
        onChange={set('experience')}
        create={emptyExperience}
        errors={errors}
        summary={(e) => ({
          primary: e.position || e.employer,
          secondary: [
            e.position ? e.employer : '',
            formatDateRange(e.startDate, e.endDate, e.current),
          ]
            .filter(Boolean)
            .join(' · '),
        })}
        renderForm={(e, update, errorFor) => (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Field id={`${id}-${e.id}-pos`} label="Position" error={errorFor('position')}>
                {(p) => (
                  <Input
                    {...p}
                    value={e.position}
                    onChange={(ev) => update({ position: ev.target.value })}
                  />
                )}
              </Field>
              <Field id={`${id}-${e.id}-emp`} label="Employer" error={errorFor('employer')}>
                {(p) => (
                  <Input
                    {...p}
                    value={e.employer}
                    onChange={(ev) => update({ employer: ev.target.value })}
                  />
                )}
              </Field>
            </div>
            <Field id={`${id}-${e.id}-loc`} label="Location" error={errorFor('location')}>
              {(p) => (
                <Input
                  {...p}
                  value={e.location}
                  onChange={(ev) => update({ location: ev.target.value })}
                />
              )}
            </Field>
            <DateFields
              item={e}
              update={update}
              errorFor={errorFor}
              currentLabel="I currently work here"
              idPrefix={`${id}-${e.id}`}
            />
            <Field
              id={`${id}-${e.id}-bullets`}
              label="What you did"
              hint="One point per line. Use your own words and real results."
              error={errorFor('bullets')}
            >
              {(p) => (
                <ListInput
                  {...p}
                  variant="lines"
                  value={e.bullets}
                  onChange={(bullets) => update({ bullets })}
                />
              )}
            </Field>
            <Field
              id={`${id}-${e.id}-tech`}
              label="Technologies used"
              hint="Comma-separated"
              error={errorFor('technologies')}
            >
              {(p) => (
                <ListInput
                  {...p}
                  variant="comma"
                  value={e.technologies}
                  onChange={(technologies) => update({ technologies })}
                />
              )}
            </Field>
          </>
        )}
      />

      <SkillsSection value={value.skills} onChange={set('skills')} errors={errors} />

      <EntryList
        title="Projects"
        path="projects"
        addLabel="Add"
        emptyText="No projects yet."
        items={value.projects}
        onChange={set('projects')}
        create={emptyProject}
        errors={errors}
        summary={(p) => ({ primary: p.name, secondary: p.technologies.join(', ') })}
        renderForm={(proj, update, errorFor) => (
          <>
            <Field id={`${id}-${proj.id}-name`} label="Project name" error={errorFor('name')}>
              {(p) => (
                <Input
                  {...p}
                  value={proj.name}
                  onChange={(ev) => update({ name: ev.target.value })}
                />
              )}
            </Field>
            <Field id={`${id}-${proj.id}-desc`} label="Description" error={errorFor('description')}>
              {(p) => (
                <Textarea
                  {...p}
                  rows={2}
                  value={proj.description}
                  onChange={(ev) => update({ description: ev.target.value })}
                />
              )}
            </Field>
            <Field
              id={`${id}-${proj.id}-tech`}
              label="Technologies"
              hint="Comma-separated"
              error={errorFor('technologies')}
            >
              {(p) => (
                <ListInput
                  {...p}
                  variant="comma"
                  value={proj.technologies}
                  onChange={(technologies) => update({ technologies })}
                />
              )}
            </Field>
            <Field id={`${id}-${proj.id}-url`} label="Link" error={errorFor('url')}>
              {(p) => (
                <Input
                  {...p}
                  type="url"
                  value={proj.url}
                  placeholder="https://github.com/…"
                  onChange={(ev) => update({ url: ev.target.value.trim() })}
                />
              )}
            </Field>
            <Field
              id={`${id}-${proj.id}-bullets`}
              label="Highlights"
              hint="One per line"
              error={errorFor('bullets')}
            >
              {(p) => (
                <ListInput
                  {...p}
                  variant="lines"
                  value={proj.bullets}
                  onChange={(bullets) => update({ bullets })}
                />
              )}
            </Field>
          </>
        )}
      />

      <EntryList
        title="Certifications"
        path="certifications"
        addLabel="Add"
        emptyText="No certifications yet."
        items={value.certifications}
        onChange={set('certifications')}
        create={emptyCertification}
        errors={errors}
        summary={(c) => ({
          primary: c.name,
          secondary: [c.issuer, formatPartialDate(c.date)].filter(Boolean).join(' · '),
        })}
        renderForm={(c, update, errorFor) => (
          <>
            <Field id={`${id}-${c.id}-name`} label="Certification" error={errorFor('name')}>
              {(p) => (
                <Input {...p} value={c.name} onChange={(ev) => update({ name: ev.target.value })} />
              )}
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field id={`${id}-${c.id}-issuer`} label="Issuer" error={errorFor('issuer')}>
                {(p) => (
                  <Input
                    {...p}
                    value={c.issuer}
                    onChange={(ev) => update({ issuer: ev.target.value })}
                  />
                )}
              </Field>
              <Field
                id={`${id}-${c.id}-date`}
                label="Date earned"
                hint={DATE_HINT}
                error={errorFor('date')}
              >
                {(p) => (
                  <Input
                    {...p}
                    value={c.date}
                    placeholder="2024-03"
                    onChange={(ev) => update({ date: ev.target.value.trim() })}
                  />
                )}
              </Field>
            </div>
            <Field
              id={`${id}-${c.id}-url`}
              label="Credential link (optional)"
              error={errorFor('credentialUrl')}
            >
              {(p) => (
                <Input
                  {...p}
                  type="url"
                  value={c.credentialUrl}
                  onChange={(ev) => update({ credentialUrl: ev.target.value.trim() })}
                />
              )}
            </Field>
          </>
        )}
      />

      {showPreferences ? (
        <PreferencesSection
          value={value.preferences}
          onChange={set('preferences')}
          errors={errors}
        />
      ) : null}
    </div>
  );
}
