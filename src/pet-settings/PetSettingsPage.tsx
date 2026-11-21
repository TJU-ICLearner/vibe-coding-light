import { useEffect, useReducer, useRef, useState } from "react";
import { Button } from "../ui/boardui/components/base/buttons/button";
import { AlertDialog } from "../ui/boardui/components/base/modal/modal";
import { Tab, TabList, TabPanel, Tabs } from "../ui/boardui/components/base/tabs/tabs";
import { formatPetError, t, type Locale, type UiKey } from "../i18n";
import { validatePetFile, type DraftMode } from "../pet/asset_draft";
import { builtinGif, BUILTIN_BUBU_ID, BUILTIN_YIER_ID } from "../pet/builtin";
import { imageForState, motionForState } from "../pet/motion";
import { applyPetMotionMetrics, BUILTIN_PET_SCALE, petWindowSide, validPetScale } from "../pet/window_size";
import type { ImportCapabilities, PetImageMode, PetMotion, PetSlot } from "../pet/types";
import { availableModes, type SettingsController } from "./model";
import "../ui/boardui.css";
import "./PetSettingsPage.css";

const slots: PetSlot[] = ["default", "working", "waiting", "error", "completed"];
const slotKeys: Record<PetSlot, UiKey> = {
  default: "state_default", working: "state_working", waiting: "state_waiting", error: "state_error", completed: "state_completed",
};
const motionValues: PetMotion[] = ["follow_state", "still", "sway", "float", "breathe", "bounce", "wobble"];

export interface PetSettingsPageProps {
  controller: SettingsController;
  locale: Locale;
  capabilities: ImportCapabilities;
  capabilitiesLoaded: boolean;
  capabilityError?: string | null;
}

export function PetSettingsPage({ controller, locale, capabilities, capabilitiesLoaded, capabilityError }: PetSettingsPageProps) {
  const [, changed] = useReducer((count: number) => count + 1, 0);
  useEffect(() => controller.onChange(changed), [controller]);
  const [selectedSlot, setSelectedSlot] = useState<PetSlot>("default");
  const [lastStateSlot, setLastStateSlot] = useState<PetSlot>("default");
  const [builtinPreviewSlot, setBuiltinPreviewSlot] = useState<PetSlot>("default");
  const [previewMode, setPreviewMode] = useState<"selected" | "draft">("selected");
  const [files, setFiles] = useState<Partial<Record<PetSlot, File>>>({});
  const [modes, setModes] = useState<Partial<Record<PetSlot, PetImageMode>>>({});
  const [motions, setMotions] = useState<Partial<Record<PetSlot, PetMotion>>>({});
  const [originalUrls, setOriginalUrls] = useState<Partial<Record<PetSlot, string>>>({});
  const originalUrlsRef = useRef<Partial<Record<PetSlot, string>>>({});
  const [name, setName] = useState("");
  const [suggestedName, setSuggestedName] = useState("");
  const [scale, setScale] = useState("0.8");
  const [draftRevision, setDraftRevision] = useState(0);
  const [savedRevision, setSavedRevision] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [retryingPet, setRetryingPet] = useState(false);
  const [completedMotionEnded, setCompletedMotionEnded] = useState(false);
  const processedRef = useRef<HTMLImageElement>(null);
  useEffect(() => () => {
    for (const url of Object.values(originalUrlsRef.current)) if (url) URL.revokeObjectURL?.(url);
  }, []);

  const availableFor = (file?: File): PetImageMode[] => {
    if (file?.name.toLowerCase().endsWith(".gif")) return capabilities.transparent_gif ? ["keep_animation"] : [];
    return availableModes(capabilities).filter((mode) => mode !== "keep_animation");
  };
  const file = files[selectedSlot];
  const available = availableFor(file);
  const currentMode = modes[selectedSlot] && available.includes(modes[selectedSlot]!) ? modes[selectedSlot]! : available[0];
  const currentEntry = controller.draft.get(selectedSlot);
  const asset = currentEntry?.asset ?? controller.draft.get("default")?.asset ?? null;
  const previewSelected = previewMode === "selected";
  const previewSlot = controller.mode === "states" ? selectedSlot : builtinPreviewSlot;
  const selectedPet = controller.activePet;
  const selectedName = selectedPet.kind === "builtin"
    ? t(locale, selectedPet.id === BUILTIN_YIER_ID ? "builtin_yier" : "builtin_cat")
    : controller.pets.find((pet) => pet.id === selectedPet.id)?.name ?? selectedPet.id;
  const selectedImage = selectedPet.kind === "photo" ? imageForState(selectedPet, previewSlot === "default" ? "idle" : previewSlot) : null;
  const previewSource = previewSelected
    ? selectedPet.kind === "builtin" ? builtinGif(selectedPet.id, previewSlot) : selectedImage?.asset.data_url
    : asset?.data_url;
  const previewMotion = previewSelected && selectedPet.kind === "photo"
    ? motionForState(selectedPet, previewSlot === "default" ? "idle" : previewSlot)
    : motions[currentEntry?.asset ? selectedSlot : "default"] ?? "follow_state";
  const animated = (previewSelected && selectedPet.kind === "builtin") || previewMotion === "gif" || (!previewSelected && asset?.kind === "gif");
  const motionClass = animated ? "animated" : completedMotionEnded && previewMotion === "follow_state" && previewSlot === "completed" ? "motion-idle" : `motion-${previewMotion === "follow_state" ? previewSlot === "default" ? "idle" : previewSlot : previewMotion}`;
  useEffect(() => setCompletedMotionEnded(false), [previewSource, previewSlot, previewMotion]);
  const previewScale = previewSelected ? selectedPet.kind === "photo" ? selectedPet.scale : BUILTIN_PET_SCALE : Number(scale);
  const side = validPetScale(previewScale) ? petWindowSide(previewScale) : 128;
  const displaySide = Math.min(side, 160);
  useEffect(() => { if (processedRef.current) applyPetMotionMetrics(processedRef.current, previewScale); }, [previewScale, previewSource]);
  const blocking = controller.draft.blockingError(controller.mode);
  const valid = validPetScale(Number(scale));
  const saveDisabled = previewSelected || savedRevision === draftRevision || controller.busy || controller.selectionPending > 0 || controller.draft.isBusy(controller.mode) || Boolean(blocking) || !controller.previewUrl || !valid;
  const status = controller.error ? formatPetError(locale, controller.error)
    : blocking ? formatPetError(locale, blocking)
    : capabilityError ? formatPetError(locale, capabilityError)
    : capabilitiesLoaded && availableModes(capabilities).length === 0 ? t(locale, "mac_only")
    : controller.busy || controller.draft.isBusy(controller.mode) ? t(locale, "processing")
    : controller.feedback === "saved_not_selected" ? t(locale, "saved_not_selected")
    : !previewSelected && savedRevision === draftRevision && controller.previewUrl ? t(locale, "draft_already_saved")
    : controller.feedback ? t(locale, controller.feedback)
    : controller.refreshFailed ? t(locale, "pet_refresh_failed")
    : previewSelected ? t(locale, "start_new_pet")
    : asset ? t(locale, "preview_ready") : t(locale, "select_default");
  const statusText = !valid && controller.previewUrl && !controller.error ? t(locale, "invalid_transform_hint") : status;
  const clearFeedback = () => { controller.feedback = null; controller.error = null; };

  const selectSlot = (slot: PetSlot) => {
    setSelectedSlot(slot);
    if (controller.mode === "states") setLastStateSlot(slot);
  };
  const chooseMode = (mode: DraftMode) => {
    if (controller.mode === mode) return;
    if (controller.mode === "states" && mode === "single") setBuiltinPreviewSlot(selectedSlot);
    controller.setMode(mode);
    setDraftRevision((value) => value + 1);
    setSelectedSlot(mode === "single" ? "default" : lastStateSlot);
  };
  const chooseFile = (nextFile: File) => {
    const mode = availableFor(nextFile)[0];
    setFiles((current) => ({ ...current, [selectedSlot]: nextFile }));
    setMotions((current) => ({ ...current, [selectedSlot]: undefined }));
    setDraftRevision((value) => value + 1);
    setPreviewMode("draft");
    if (!mode) { controller.error = { code: "mode_unsupported" }; changed(); return; }
    setModes((current) => ({ ...current, [selectedSlot]: mode }));
    const old = originalUrlsRef.current[selectedSlot];
    if (old) URL.revokeObjectURL?.(old);
    const next = !validatePetFile(nextFile, mode) && URL.createObjectURL ? URL.createObjectURL(nextFile) : undefined;
    originalUrlsRef.current[selectedSlot] = next;
    setOriginalUrls({ ...originalUrlsRef.current });
    if (selectedSlot === "default") {
      const suggestion = nextFile.name.replace(/\.[^.]+$/, "");
      if (!name.trim() || name === suggestedName) setName(suggestion);
      setSuggestedName(suggestion);
    }
    void controller.loadSlot(selectedSlot, nextFile, mode);
  };
  const changeMode = (mode: PetImageMode) => {
    setModes((current) => ({ ...current, [selectedSlot]: mode }));
    if (file) {
      setDraftRevision((value) => value + 1);
      setPreviewMode("draft");
      void controller.loadSlot(selectedSlot, file, mode);
    }
  };
  const clearSlot = () => {
    setDraftRevision((value) => value + 1);
    clearFeedback();
    controller.draft.clear(selectedSlot);
    setFiles((current) => ({ ...current, [selectedSlot]: undefined }));
    setModes((current) => ({ ...current, [selectedSlot]: undefined }));
    setMotions((current) => ({ ...current, [selectedSlot]: undefined }));
    const old = originalUrlsRef.current[selectedSlot];
    if (old) URL.revokeObjectURL?.(old);
    originalUrlsRef.current[selectedSlot] = undefined;
    setOriginalUrls({ ...originalUrlsRef.current });
    setPreviewMode("draft");
  };
  const selectPet = (id: string) => {
    setConfirmDeleteId(null);
    void controller.select(id).then(() => {
      setPreviewMode("selected");
      setBuiltinPreviewSlot("default");
    }).catch(() => {});
  };
  const savePet = () => {
    if (saveDisabled || controller.busy) return;
    const revision = draftRevision;
    void controller.save(name, Number(scale), motions).then((saved) => {
      setSavedRevision(revision);
      if (controller.selectedId === saved.id) setPreviewMode("selected");
    }).catch(() => {});
  };
  const deletePet = async () => {
    if (!confirmDeleteId || deletingId) return;
    const id = confirmDeleteId;
    const wasSelected = controller.selectedId === id;
    setDeletingId(id);
    try {
      await controller.delete(id);
      setConfirmDeleteId(null);
      if (wasSelected) setPreviewMode("selected");
    } finally { setDeletingId(null); }
  };
  const retryRefresh = () => {
    if (retryingPet) return;
    setRetryingPet(true);
    void controller.refresh().then((complete) => {
      if (complete && controller.feedback?.endsWith("_refresh_failed")) controller.feedback = null;
    }).finally(() => setRetryingPet(false));
  };
  const deleteName = controller.pets.find((pet) => pet.id === confirmDeleteId)?.name ?? "";

  return <>
    <header className="pet-page-header"><p className="eyebrow">VIBE CODING LIGHT</p><h1>{t(locale, "settings_title")}</h1><p>{t(locale, "settings_intro")}</p></header>
    <div className="editor-layout">
      <aside id="preview-panel" className={`preview-panel ${previewSelected ? "selected-preview" : ""}`} aria-label={t(locale, "processed_alt")}>
        <div className="preview-heading"><span>{t(locale, "processed")}</span><span className="preview-size">{side} × {side}</span></div>
        <p id="preview-context" className="preview-context">{previewSelected ? t(locale, "selected_preview", { name: selectedName }) : t(locale, "draft_preview")}</p>
        <Button id="resume-draft" variant="ghost" size="small" hidden={!previewSelected || !controller.previewUrl} onClick={() => setPreviewMode("draft")}>{t(locale, "resume_draft")}</Button>
        <div className="preview-box checker"><div className="preview-viewport" style={{ width: displaySide, height: displaySide }}><div className="preview-window" style={{ width: side, height: side, transform: `scale(${displaySide / side})` }}><div id="processed-frame" style={{ transform: `scale(${previewScale})` }}><img ref={processedRef} id="processed-preview" src={previewSource || undefined} alt={t(locale, "processed_alt")} className={motionClass} onAnimationEnd={(event) => { if (event.animationName === "pet-photo-completed" && !animated) setCompletedMotionEnded(true); }} /></div></div></div></div>
        <label id="builtin-preview-control" className="builtin-preview-control" hidden={!previewSelected || controller.mode === "states"}><span>{t(locale, "state_preview")}</span><select id="builtin-preview-state" aria-label={t(locale, "state_preview")} value={builtinPreviewSlot} onChange={(event) => setBuiltinPreviewSlot(event.target.value as PetSlot)}>{slots.map((slot) => <option value={slot} key={slot}>{t(locale, slotKeys[slot])}</option>)}</select></label>
        {!previewSelected && <div id="original-row" className="original-row"><span>{t(locale, "original")}</span><div className="original-thumb"><img id="original-preview" src={originalUrls[selectedSlot] ?? originalUrls.default} alt={t(locale, "original_alt")} /></div></div>}
      </aside>
      <div className="editor-main">
        <section className="panel import-panel">
          <div className="pet-section-heading"><span className="pet-step">01</span><h2>{t(locale, "import_heading")}</h2></div>
          <span className="pet-field-label">{t(locale, "style_label")}</span>
          <Tabs selectedKey={controller.mode} onSelectionChange={(key) => chooseMode(key as DraftMode)} aria-label={t(locale, "style_label")} className="pet-mode-tabs"><TabList aria-label={t(locale, "style_label")}><Tab id="single">{t(locale, "style_single")}</Tab><Tab id="states">{t(locale, "style_states")}</Tab></TabList><TabPanel id="single" className="pet-empty-panel" /><TabPanel id="states" className="pet-empty-panel" /></Tabs>
          <p id="mode-hint" className="hint">{t(locale, controller.mode === "single" ? "single_hint" : "states_hint")}</p>
          <div id="asset-editor" className="asset-editor">
            <div id="slot-tabs" hidden={controller.mode !== "states"}><Tabs selectedKey={selectedSlot} onSelectionChange={(key) => selectSlot(key as PetSlot)} aria-label={t(locale, "state_preview")} className="pet-state-tabs"><TabList aria-label={t(locale, "state_preview")} className="slot-tabs">{slots.map((slot) => {
              const hasAsset = previewSelected ? selectedPet.kind === "builtin" || Boolean(selectedPet.assets[slot]) : Boolean(controller.draft.get(slot)?.asset);
              return <Tab key={slot} id={slot} data-slot={slot}><span className="tab-label">{t(locale, slotKeys[slot])}</span><span className="tab-detail">{t(locale, hasAsset ? "slot_set" : slot === "default" ? "slot_required" : "slot_fallback")}</span></Tab>;
            })}</TabList>{slots.map((slot) => <TabPanel key={slot} id={slot} className="pet-empty-panel" />)}</Tabs></div><p id="waiting-help" className="hint" hidden={controller.mode !== "states"}>{t(locale, "waiting_help")}</p>
            <div className="slot-editor-heading"><h3 id="slot-editor-title">{t(locale, slotKeys[selectedSlot])}</h3><span id="slot-completion" className={`slot-completion ${currentEntry?.asset ? "complete" : ""}`}>{t(locale, currentEntry?.asset ? "slot_set" : selectedSlot === "default" ? "slot_required" : "slot_fallback")}</span></div>
            <label className="pet-upload-label"><span id="slot-file-label">{t(locale, selectedSlot === "default" ? "default_asset" : "upload_image")}</span><input key={selectedSlot} id="photo-file" type="file" accept="image/png,image/jpeg,image/gif" disabled={capabilitiesLoaded && availableModes(capabilities).length === 0} onChange={(event) => { const next = event.target.files?.[0]; if (next) chooseFile(next); }} /></label>
            <p id="slot-file-name" className="file-name">{file ? t(locale, "file_selected", { name: file.name }) : ""}</p>
            <label><span>{t(locale, "processing_mode")}</span><select id="photo-mode" value={currentMode ?? ""} disabled={available.length <= 1} onChange={(event) => changeMode(event.target.value as PetImageMode)}>{available.map((mode) => <option key={mode} value={mode}>{t(locale, mode)}</option>)}</select></label>
            <label><span>{t(locale, "motion_label")}</span><select id="pet-motion" value={motions[selectedSlot] ?? "follow_state"} disabled={currentEntry?.asset?.kind !== "png"} onChange={(event) => { if (currentEntry?.asset?.kind !== "png") return; setMotions((current) => ({ ...current, [selectedSlot]: event.target.value as PetMotion })); setDraftRevision((value) => value + 1); setPreviewMode("draft"); clearFeedback(); }}>{motionValues.map((motion) => <option key={motion} value={motion}>{t(locale, `motion_${motion}` as UiKey)}</option>)}</select></label>
            {currentEntry?.asset?.kind !== "png" && <p id="motion-hint" className="hint">{t(locale, currentEntry?.asset?.kind === "gif" ? "motion_gif_hint" : "motion_upload_hint")}</p>}
            <p id="slot-status" className={`slot-status ${currentEntry?.error ? "error" : ""}`} role="status">{currentEntry?.error ? formatPetError(locale, currentEntry.error) : currentEntry?.busy ? t(locale, "processing_short") : currentEntry?.asset ? t(locale, "preview_ready_short") : selectedSlot === "default" ? t(locale, "select_default") : t(locale, "fallback_default")}</p>
            {selectedSlot !== "default" && file && <Button id="slot-clear" variant="ghost" size="small" onClick={clearSlot}>{t(locale, "remove_slot")}</Button>}
          </div>
        </section>
        <section className="panel">
          <div className="pet-section-heading"><span className="pet-step">02</span><h2>{t(locale, "adjust_heading")}</h2></div>
          <div className="controls"><label><span>{t(locale, "name")}</span><input id="pet-name" maxLength={64} placeholder={t(locale, "name_placeholder")} value={name} onChange={(event) => { setName(event.target.value); setDraftRevision((value) => value + 1); if (controller.previewUrl) setPreviewMode("draft"); clearFeedback(); }} /></label><label><span>{t(locale, "scale")}</span><input id="pet-scale" type="number" min="0.5" max="3" step="0.1" value={scale} onChange={(event) => { setScale(event.target.value); setDraftRevision((value) => value + 1); if (controller.previewUrl) { setPreviewMode("draft"); clearFeedback(); } }} /></label></div>
          <p id="status" role="status" className={controller.error || blocking || !valid ? "error" : ""}>{statusText}</p>
          <Button id="save-pet" className="pet-save-button" disabled={saveDisabled} onClick={savePet}>{t(locale, "save_use")}</Button>
        </section>
      </div>
    </div>
    <section className="panel pet-library"><div className="pet-section-heading"><span className="pet-step">03</span><h2>{t(locale, "saved_heading")}</h2></div><p id="saved-warning" className="warning" role="status" hidden={controller.invalidSlots.length === 0}>{controller.invalidSlots.length > 0 ? t(locale, "invalid_saved_slots", { slots: controller.invalidSlots.map((slot) => t(locale, slotKeys[slot])).join(locale === "en" ? ", " : "、") }) : ""}</p><Button id="retry-pet-refresh" variant="ghost" size="small" hidden={!controller.refreshFailed} disabled={retryingPet} onClick={retryRefresh}>{t(locale, "retry_pet_refresh")}</Button><div id="saved-pets">{([[BUILTIN_BUBU_ID, "builtin_cat"], [BUILTIN_YIER_ID, "builtin_yier"]] as const).map(([id, key]) => <Button key={id} data-pet-id={id} variant={controller.selectedId === id ? "primary" : "secondary"} disabled={controller.busy} onClick={() => selectPet(id)}>{t(locale, key)}</Button>)}{controller.pets.map((pet) => <div className="saved-row" key={pet.id}><Button variant={controller.selectedId === pet.id ? "primary" : "secondary"} disabled={controller.busy} onClick={() => selectPet(pet.id)}>{pet.name}</Button><Button variant="secondary" aria-label={t(locale, "delete_named", { name: pet.name })} disabled={controller.busy || deletingId !== null} onClick={() => setConfirmDeleteId(pet.id)}>{t(locale, "delete")}</Button></div>)}</div></section>
    <AlertDialog isOpen={confirmDeleteId !== null} onOpenChange={(open) => { if (!open) setConfirmDeleteId(null); }} title={t(locale, "delete_named", { name: deleteName })} description={t(locale, "delete_confirm", { name: deleteName })} confirmLabel={t(locale, "delete_confirm_action")} cancelLabel={t(locale, "delete_cancel")} onConfirm={deletePet} onCancel={() => setConfirmDeleteId(null)} />
  </>;
}
