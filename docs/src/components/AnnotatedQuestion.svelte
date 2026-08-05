<script lang="ts">
  type Kind =
    | "text"
    | "integer"
    | "decimal"
    | "date"
    | "time"
    | "note"
    | "select_one"
    | "select_multiple"
    | "select_one_other"
    | "select_multiple_other"
    | "select_one_from_file"
    | "select_multiple_from_file"
    | "matrix"
    | "begin_group";

  interface Props {
    kind: Kind;
  }
  let { kind }: Props = $props();

  // Single-input, single-variable configs (label / hint / input attrs / var / samples).
  const singleVar: Partial<Record<Kind, {
    label: string;
    hint?: string;
    inputType: string;
    inputTag: string;
    placeholder?: string;
    varName: string;
    varTag: string;
    samples: string[];
    typeNote: string;
  }>> = {
    text: {
      label: "What is your current job title?",
      hint: "If you hold more than one role, list your primary one.",
      inputType: "text", inputTag: "input · free text",
      placeholder: "Type your answer…",
      varName: "V_jobtitle", varTag: "dataset (1 var)",
      samples: ["Data scientist", "Survey methodologist", "…"],
      typeNote: "type: string",
    },
    integer: {
      label: "How old are you?",
      hint: "In completed years.",
      inputType: "number", inputTag: "input · integer",
      placeholder: "0",
      varName: "V_age", varTag: "dataset (1 var)",
      samples: ["34", "51", "…"],
      typeNote: "type: integer",
    },
    decimal: {
      label: "How many hours did you work last week?",
      inputType: "number", inputTag: "input · decimal",
      placeholder: "0.0",
      varName: "V_hours", varTag: "dataset (1 var)",
      samples: ["37.5", "40.0", "…"],
      typeNote: "type: decimal",
    },
    date: {
      label: "What is your date of birth?",
      inputType: "date", inputTag: "input · date",
      varName: "V_dob", varTag: "dataset (1 var)",
      samples: ["1990-04-12", "1978-11-30", "…"],
      typeNote: "type: date (ISO 8601)",
    },
    time: {
      label: "What time do you usually start work?",
      inputType: "time", inputTag: "input · time",
      varName: "V_starttime", varTag: "dataset (1 var)",
      samples: ["09:00", "08:30", "…"],
      typeNote: "type: time (HH:MM)",
    },
  };

  const cfg = $derived(singleVar[kind] ?? null);
</script>

<div class="aq">
  <div class="col-head">Presentation</div>
  <div class="col-head">Data</div>

  {#if cfg}
    <div class="col present-col">
      <div class="ann label" data-tag="label">{cfg.label}</div>
      {#if cfg.hint}<div class="ann hint" data-tag="hint">{cfg.hint}</div>{/if}
      <div class="ann input" data-tag={cfg.inputTag}>
        <input type={cfg.inputType} placeholder={cfg.placeholder ?? ""} />
      </div>
    </div>
    <div class="col data-col">
      <div class="ann data" data-tag={cfg.varTag}>
        <table class="ds">
          <thead><tr><th>{cfg.varName}</th></tr></thead>
          <tbody>
            {#each cfg.samples as s}
              <tr><td class={s === "…" ? "muted" : ""}>{s}</td></tr>
            {/each}
          </tbody>
        </table>
        <p class="type-note">{cfg.typeNote}</p>
      </div>
    </div>

  {:else if kind === "note"}
    <div class="col present-col">
      <div class="ann label" data-tag="label (display only)">
        Thank you for taking the time to complete this survey. The next section
        asks about your work.
      </div>
      <div class="ann input" data-tag="no input">
        <em style="color: color-mix(in srgb, var(--color-text-primary) 55%, transparent);">
          Read-only text — respondent has nothing to fill in.
        </em>
      </div>
    </div>
    <div class="col data-col">
      <div class="ann data" data-tag="dataset (0 vars)">
        <p class="type-note">Not stored in the dataset.</p>
      </div>
    </div>

  {:else if kind === "begin_group"}
    <div class="col present-col">
      <div class="ann label" data-tag="group label">
        Work-related questions
      </div>
      <div class="ann input" data-tag="structural · groups following rows">
        <em style="color: color-mix(in srgb, var(--color-text-primary) 55%, transparent);">
          Container — the individual questions inside the group appear below in
          the form.
        </em>
      </div>
    </div>
    <div class="col data-col">
      <div class="ann data" data-tag="dataset (0 vars for the group itself)">
        <p class="type-note">
          The group emits no column of its own. Each question inside the group
          contributes its own columns (typically prefixed with the group name).
        </p>
      </div>
    </div>

  {:else if kind === "select_one" || kind === "select_one_from_file"}
    <div class="col present-col">
      <div class="ann label" data-tag="label">What is your highest completed level of education?</div>
      <div class="ann hint" data-tag="hint">Pick the one that fits best.</div>
      <div class="ann input" data-tag="input · radio (pick one)">
        <div class="ann option" data-tag="option (1 of choice list)">
          <label><input type="radio" name="so" /> None</label>
        </div>
        <label class="opt-plain"><input type="radio" name="so" /> Primary</label>
        <label class="opt-plain"><input type="radio" name="so" /> Secondary</label>
        <label class="opt-plain"><input type="radio" name="so" /> Tertiary</label>
      </div>
      {#if kind === "select_one_from_file"}
        <p class="row-note">
          Choice list loaded from a CSV file — appears in DDI as
          <code>concept/@vocab</code> pointing to a named vocabulary rather
          than inline categories.
        </p>
      {/if}
    </div>
    <div class="col data-col">
      <div class="ann data" data-tag="dataset (1 var)">
        <table class="ds">
          <thead><tr><th>V_edu</th></tr></thead>
          <tbody>
            <tr><td>2</td></tr>
            <tr><td>3</td></tr>
            <tr><td class="muted">…</td></tr>
          </tbody>
        </table>
        <p class="type-note">type: categorical · code = choice value</p>
      </div>
    </div>

  {:else if kind === "select_multiple" || kind === "select_multiple_from_file"}
    <div class="col present-col">
      <div class="ann label" data-tag="label">Which of these tools do you use regularly?</div>
      <div class="ann hint" data-tag="hint">Select all that apply.</div>
      <div class="ann input" data-tag="input · checkboxes (pick any)">
        <div class="ann option" data-tag="option (1 of choice list)">
          <label><input type="checkbox" /> XLSForm</label>
        </div>
        <label class="opt-plain"><input type="checkbox" /> LimeSurvey</label>
        <label class="opt-plain"><input type="checkbox" /> DDI-Codebook</label>
      </div>
      {#if kind === "select_multiple_from_file"}
        <p class="row-note">
          Choice list loaded from a CSV file — vocabulary reference in DDI
          (<code>concept/@vocab</code>) rather than inline categories.
        </p>
      {/if}
    </div>
    <div class="col data-col">
      <div class="ann data" data-tag="dataset (N vars)">
        <table class="ds">
          <thead>
            <tr>
              <th>V_tools_xlsform</th>
              <th>V_tools_limesurvey</th>
              <th>V_tools_ddi</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>1</td><td>1</td><td>0</td></tr>
            <tr><td>0</td><td>0</td><td>1</td></tr>
            <tr><td class="muted">…</td><td class="muted">…</td><td class="muted">…</td></tr>
          </tbody>
        </table>
        <p class="type-note">N binary vars (0/1) · DDI <code>varGrp@type=multipleResp</code></p>
      </div>
    </div>

  {:else if kind === "select_one_other"}
    <div class="col present-col">
      <div class="ann label" data-tag="label">What is your highest completed level of education?</div>
      <div class="ann hint" data-tag="hint">Pick the one that fits best.</div>
      <div class="ann input" data-tag="input · radio (pick one)">
        <label class="opt-plain"><input type="radio" name="soo" /> None</label>
        <label class="opt-plain"><input type="radio" name="soo" /> Primary</label>
        <label class="opt-plain"><input type="radio" name="soo" /> Secondary</label>
        <label class="opt-plain"><input type="radio" name="soo" /> Tertiary</label>
        <div class="ann option" data-tag="option · other (triggers _other field)">
          <label><input type="radio" name="soo" /> Other</label>
          <input class="specify" type="text" placeholder="please specify…" />
        </div>
      </div>
    </div>
    <div class="col data-col">
      <div class="ann data" data-tag="dataset (2 vars)">
        <table class="ds">
          <thead><tr><th>V_edu</th><th>V_edu_other</th></tr></thead>
          <tbody>
            <tr><td>2</td><td></td></tr>
            <tr><td>other</td><td>Vocational apprenticeship</td></tr>
            <tr><td class="muted">…</td><td class="muted">…</td></tr>
          </tbody>
        </table>
        <p class="type-note">
          1 categorical + 1 string var · DDI <code>varGrp@type=other</code>
          wrapping base var + <code>_other</code> text var
        </p>
      </div>
    </div>

  {:else if kind === "select_multiple_other"}
    <div class="col present-col">
      <div class="ann label" data-tag="label">Which of these tools do you use regularly?</div>
      <div class="ann hint" data-tag="hint">Select all that apply.</div>
      <div class="ann input" data-tag="input · checkboxes (pick any)">
        <label class="opt-plain"><input type="checkbox" /> XLSForm</label>
        <label class="opt-plain"><input type="checkbox" /> LimeSurvey</label>
        <label class="opt-plain"><input type="checkbox" /> DDI-Codebook</label>
        <div class="ann option" data-tag="option · other (triggers _other field)">
          <label><input type="checkbox" /> Other</label>
          <input class="specify" type="text" placeholder="please specify…" />
        </div>
      </div>
    </div>
    <div class="col data-col">
      <div class="ann data" data-tag="dataset (N+1 vars)">
        <table class="ds">
          <thead>
            <tr>
              <th>V_tools_xlsform</th>
              <th>V_tools_limesurvey</th>
              <th>V_tools_ddi</th>
              <th>V_tools_other</th>
              <th>V_tools_other_specify</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>1</td><td>1</td><td>0</td><td>0</td><td></td></tr>
            <tr><td>0</td><td>0</td><td>1</td><td>1</td><td>RDF Data Cube</td></tr>
          </tbody>
        </table>
        <p class="type-note">
          N binary vars + 1 <code>_specify</code> string var · DDI
          <code>varGrp@type=other</code> around the multipleResp group
        </p>
      </div>
    </div>

  {:else if kind === "matrix"}
    <div class="col present-col">
      <div class="ann label" data-tag="group label">Rate the following tools.</div>
      <div class="ann hint" data-tag="hint">One choice per row.</div>
      <div class="ann input" data-tag="input · grid (composite of N select_one rows)">
        <div class="cols-rail">
          <div class="rail-line"></div>
          <span class="rail-tag">shared choice list (Bad · OK · Good)</span>
        </div>
        <table class="matrix">
          <thead>
            <tr><th></th><th>Bad</th><th>OK</th><th>Good</th></tr>
          </thead>
          <tbody>
            <tr>
              <th class="row-lbl">XLSForm</th>
              <td><input type="radio" name="m1" /></td>
              <td><input type="radio" name="m1" /></td>
              <td><input type="radio" name="m1" /></td>
            </tr>
            <tr>
              <th class="row-lbl">LimeSurvey</th>
              <td><input type="radio" name="m2" /></td>
              <td><input type="radio" name="m2" /></td>
              <td><input type="radio" name="m2" /></td>
            </tr>
            <tr>
              <th class="row-lbl">DDI-Codebook</th>
              <td><input type="radio" name="m3" /></td>
              <td><input type="radio" name="m3" /></td>
              <td><input type="radio" name="m3" /></td>
            </tr>
          </tbody>
        </table>
        <p class="row-note">each row = 1 XLSForm row = 1 var</p>
      </div>
    </div>
    <div class="col data-col">
      <div class="ann data" data-tag="dataset (N vars)">
        <table class="ds">
          <thead>
            <tr><th>V_rate_xlsform</th><th>V_rate_limesurvey</th><th>V_rate_ddi</th></tr>
          </thead>
          <tbody>
            <tr><td>3</td><td>2</td><td>1</td></tr>
            <tr><td>2</td><td>3</td><td>3</td></tr>
            <tr><td class="muted">…</td><td class="muted">…</td><td class="muted">…</td></tr>
          </tbody>
        </table>
        <p class="type-note">N categorical vars · all share code list (1 Bad / 2 OK / 3 Good)</p>
      </div>
    </div>
  {/if}
</div>

<style>
  .aq {
    display: grid;
    grid-template-columns: minmax(0, 2.2fr) minmax(0, 2fr);
    gap: 1.5rem;
    background: var(--color-bg-elevated, #fff);
    padding: 1.5rem 1.25rem 1.25rem;
    border-radius: 6px;
    border: 1px solid color-mix(in srgb, var(--color-text-primary) 10%, transparent);
    margin-bottom: 1rem;
  }
  @media (max-width: 900px) {
    .aq { grid-template-columns: 1fr; }
  }

  .aq, .aq * {
    text-transform: none !important;
    letter-spacing: normal !important;
  }

  .col { min-width: 0; }
  .col-head {
    font-size: 0.72rem;
    font-family: var(--font-mono, monospace);
    text-transform: uppercase !important;
    letter-spacing: 0.06em !important;
    color: color-mix(in srgb, var(--color-text-primary) 55%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--color-text-primary) 12%, transparent);
    padding-bottom: 0.3rem;
    margin-bottom: 0.2rem;
  }
  @media (max-width: 900px) {
    .col-head { margin-top: 0.6rem; }
  }

  .ann {
    position: relative;
    border: 1.5px dashed var(--ann-color, #888);
    border-radius: 4px;
    padding: 0.6rem 0.75rem;
    margin: 1.15rem 0 0.4rem;
  }
  .ann::before {
    content: attr(data-tag);
    position: absolute;
    top: -0.65rem;
    left: 0.6rem;
    background: var(--color-bg-elevated, #fff);
    padding: 0 0.35rem;
    font-size: 0.7rem;
    font-family: var(--font-mono, monospace);
    color: var(--ann-color, #888);
    text-transform: none !important;
    letter-spacing: 0.02em !important;
  }

  .ann { --ann-color: #64748b; }
  .label   { font-weight: 600; }
  .hint    { font-style: italic; font-size: 0.9rem; }
  .option  { padding: 0.35rem 0.6rem; margin: 0.45rem 0; display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }

  .opt-plain {
    display: flex;
    gap: 0.4rem;
    align-items: center;
    padding: 0.35rem 0.6rem;
    margin: 0.45rem 0;
  }
  .specify {
    flex: 1;
    min-width: 8rem;
    width: auto !important;
  }

  input[type="text"],
  input[type="number"],
  input[type="date"],
  input[type="time"] {
    padding: 0.4rem 0.55rem;
    border: 1px solid #cbd5e1;
    border-radius: 4px;
    font: inherit;
    width: 100%;
    box-sizing: border-box;
  }
  label { display: inline-flex; gap: 0.4rem; align-items: center; cursor: pointer; }

  .ds {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--font-mono, monospace);
    font-size: 0.72rem;
    margin-top: 0.25rem;
    table-layout: fixed;
  }
  .ds th, .ds td {
    border: 1px solid color-mix(in srgb, var(--color-text-primary) 12%, transparent);
    padding: 0.3rem 0.4rem;
    text-align: left;
    overflow-wrap: anywhere;
    word-break: break-word;
    line-height: 1.3;
  }
  .ds thead th { font-size: 0.7rem; }
  .ds thead th {
    background: color-mix(in srgb, var(--color-text-primary) 6%, transparent);
    font-weight: 600;
  }
  .ds .muted { color: color-mix(in srgb, var(--color-text-primary) 45%, transparent); }
  .type-note {
    font-size: 0.78rem;
    color: color-mix(in srgb, var(--color-text-primary) 65%, transparent);
    margin: 0.35rem 0 0;
    font-style: italic;
  }
  .row-note {
    font-size: 0.78rem;
    color: color-mix(in srgb, var(--color-text-primary) 70%, transparent);
    margin: 0.4rem 0 0;
    font-family: var(--font-mono, monospace);
  }

  .cols-rail {
    position: relative;
    margin: 0.3rem 0 0.15rem;
    padding-top: 0.6rem;
  }
  .rail-line {
    height: 0;
    border-top: 1.5px dashed #64748b;
    margin: 0 0 0.15rem;
  }
  .rail-tag {
    display: inline-block;
    font-family: var(--font-mono, monospace);
    font-size: 0.7rem;
    color: #64748b;
    background: var(--color-bg-elevated, #fff);
    padding: 0 0.3rem;
    position: absolute;
    top: -0.05rem;
    left: 0.6rem;
  }
  .matrix { width: 100%; border-collapse: collapse; }
  .matrix th, .matrix td {
    padding: 0.4rem 0.5rem;
    text-align: center;
    border: 1px solid color-mix(in srgb, var(--color-text-primary) 8%, transparent);
  }
  .matrix thead th { background: color-mix(in srgb, var(--color-text-primary) 4%, transparent); font-weight: 600; }
  .row-lbl { text-align: left; }
</style>
