// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`): create a page — a report, a note
// dictated to a voice scene — or add a line at the end of a "journal" page
// (created at its first line): a log of the boiler, of the alarm, of the
// garden, written by Gladys in the wiki.
// -----------------------------------------------------------------------------

export const SCENE_ACTIONS = {
  async create_page(hub, { fields = {} }) {
    return hub.createPage({
      path: fields.path,
      title: fields.title,
      content: fields.content,
      tags: fields.tags,
    });
  },
  async append_line(hub, { fields = {} }) {
    return hub.appendToPage({
      path: fields.path,
      line: fields.line,
      addTime: fields.add_time,
      title: fields.title,
    });
  },
};
