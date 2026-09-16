export const VIDEO_STAGES = [
  { id: 'input', label: 'Script intake' },
  { id: 'plan', label: 'Script analysis & scene planning' },
  { id: 'assets', label: 'Asset generation' },
  { id: 'assemble', label: 'Video assembly' },
  { id: 'store', label: 'Store & review' },
  { id: 'publish', label: 'Publish packages' },
];

export function createPipelineStages() {
  return VIDEO_STAGES.map((stage) => ({ ...stage, status: 'pending' }));
}

export function setPipelineStage(stages, id, status) {
  const order = VIDEO_STAGES.map((stage) => stage.id);
  const currentIndex = order.indexOf(id);
  return (stages || createPipelineStages()).map((stage) => {
    const index = order.indexOf(stage.id);
    if (stage.id === id) return { ...stage, status };
    if (index < currentIndex && stage.status !== 'done') return { ...stage, status: 'done' };
    return stage;
  });
}
