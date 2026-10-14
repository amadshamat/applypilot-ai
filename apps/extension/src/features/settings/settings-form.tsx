import { useEffect, useId, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  DEFAULT_MATCH_WEIGHTS,
  settingsSchema,
  type MatchWeights,
  type Settings,
} from '@applypilot/shared';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card, CardDescription, CardTitle } from '../../components/ui/card';
import { Switch } from '../../components/ui/switch';

const WEIGHT_LABELS: Record<keyof MatchWeights, string> = {
  requiredSkills: 'Required skills',
  experience: 'Relevant experience',
  education: 'Education and eligibility',
  preferredSkills: 'Preferred skills',
  otherRequirements: 'Other requirements',
};

const WEIGHT_KEYS = Object.keys(WEIGHT_LABELS) as (keyof MatchWeights)[];

export function SettingsForm({
  settings,
  onSave,
}: {
  settings: Settings;
  onSave: (s: Settings) => Promise<unknown>;
}) {
  const id = useId();
  const [saved, setSaved] = useState(false);
  const form = useForm<Settings>({
    resolver: zodResolver(settingsSchema),
    defaultValues: settings,
    mode: 'onChange',
  });
  const { register, control, handleSubmit, reset, setValue, formState } = form;

  // Follow changes saved from another page (options page ⇄ side panel).
  useEffect(() => {
    reset(settings);
  }, [settings, reset]);

  const weights = useWatch({ control, name: 'matchWeights' });
  const total = WEIGHT_KEYS.reduce(
    (sum, key) => sum + (Number.isFinite(weights[key]) ? weights[key] : 0),
    0,
  );

  const submit = handleSubmit(async (values) => {
    await onSave(values);
    setSaved(true);
  });

  return (
    <form
      onSubmit={(event) => void submit(event)}
      onChange={() => setSaved(false)}
      className="space-y-3"
      noValidate
    >
      <Card className="space-y-3">
        <CardTitle>Appearance</CardTitle>
        <div className="flex items-center justify-between gap-3">
          <label htmlFor={`${id}-theme`} className="text-sm">
            Theme
          </label>
          <select
            id={`${id}-theme`}
            {...register('theme')}
            className="h-8 rounded-lg border border-border bg-surface px-2 text-sm"
          >
            <option value="system">Match system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
      </Card>

      <Card className="space-y-3">
        <CardTitle>Privacy</CardTitle>
        <Controller
          control={control}
          name="allowAiProcessing"
          render={({ field }) => (
            <div className="flex items-start justify-between gap-3">
              <div>
                <label htmlFor={`${id}-ai`} className="text-sm">
                  Allow AI processing
                </label>
                <p id={`${id}-ai-help`} className="text-xs text-muted">
                  Off by default. When AI features arrive (Phase 3), job text and the profile
                  details you choose will be sent to the ApplyPilot server only while this is on.
                  Phase 1 never sends data anywhere.
                </p>
              </div>
              <Switch
                id={`${id}-ai`}
                checked={field.value}
                onCheckedChange={(v) => {
                  field.onChange(v);
                  setSaved(false);
                }}
                aria-describedby={`${id}-ai-help`}
              />
            </div>
          )}
        />
        <Controller
          control={control}
          name="cacheAnalyses"
          render={({ field }) => (
            <div className="flex items-start justify-between gap-3">
              <div>
                <label htmlFor={`${id}-cache`} className="text-sm">
                  Remember analyses per tab
                </label>
                <p id={`${id}-cache-help`} className="text-xs text-muted">
                  Keeps the last analysis of each tab in memory until the tab navigates or closes.
                </p>
              </div>
              <Switch
                id={`${id}-cache`}
                checked={field.value}
                onCheckedChange={(v) => {
                  field.onChange(v);
                  setSaved(false);
                }}
                aria-describedby={`${id}-cache-help`}
              />
            </div>
          )}
        />
      </Card>

      <Card className="space-y-3">
        <div>
          <CardTitle>Match score weights</CardTitle>
          <CardDescription>
            Heuristics, not hiring rules. Used by the match score in Phase 2. Weights must add up to
            100.
          </CardDescription>
        </div>
        <div className="space-y-2">
          {WEIGHT_KEYS.map((key) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <label htmlFor={`${id}-${key}`} className="text-sm">
                {WEIGHT_LABELS[key]}
              </label>
              <div className="flex items-center gap-1">
                <input
                  id={`${id}-${key}`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={100}
                  step={1}
                  {...register(`matchWeights.${key}`, { valueAsNumber: true })}
                  className="h-8 w-16 rounded-lg border border-border bg-surface px-2 text-right text-sm"
                />
                <span className="text-xs text-muted" aria-hidden>
                  %
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className={total === 100 ? 'text-success' : 'text-danger'} aria-live="polite">
            Total: {total}%
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setValue(
                'matchWeights',
                { ...DEFAULT_MATCH_WEIGHTS },
                { shouldDirty: true, shouldValidate: true },
              );
              setSaved(false);
            }}
          >
            Reset to defaults
          </Button>
        </div>
        {formState.errors.matchWeights ? (
          <p role="alert" className="text-xs text-danger">
            {formState.errors.matchWeights.root?.message ??
              formState.errors.matchWeights.message ??
              'Each weight must be a whole number from 0 to 100.'}
          </p>
        ) : null}
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!formState.isValid || formState.isSubmitting}>
          Save settings
        </Button>
        {saved ? (
          <span role="status" className="text-xs text-success">
            Settings saved
          </span>
        ) : null}
      </div>
    </form>
  );
}

export function SettingsLoadError({ message }: { message: string }) {
  return (
    <Alert tone="error" title="Settings could not be loaded">
      {message}
    </Alert>
  );
}
