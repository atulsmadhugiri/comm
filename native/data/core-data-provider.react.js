// @flow

import './core-module-shim';
import * as React from 'react';

import {
  type CoreDataDrafts,
  defaultCoreData,
  CoreDataContext,
} from './core-data';

type Props = {|
  +children: React.Node,
|};
function CoreDataProvider(props: Props) {
  const [draftCache, setDraftCache] = React.useState<
    $PropertyType<CoreDataDrafts, 'data'>,
  >(defaultCoreData.drafts.data);

  React.useEffect(() => {
    (async () => {
      const fetchedDrafts = await global.CommCoreModule.getAllDrafts();
      setDraftCache((prevDrafts) => {
        const mergedDrafts = {};
        for (const draftObj of fetchedDrafts) {
          mergedDrafts[draftObj.key] = draftObj.text;
        }
        for (const key in prevDrafts) {
          const value = prevDrafts[key];
          if (!value) {
            continue;
          }
          mergedDrafts[key] = value;
        }
        return mergedDrafts;
      });
    })();
  }, []);

  /**
   * wrapper for updating the draft state receiving an array of drafts
   *  if you want to add/update the draft, pass the draft with non-empty text
   *  if you pass a draft with !!text == false
   * it will remove this entry from the cache
   */
  const setDrafts = React.useCallback(
    (newDrafts: $ReadOnlyArray<{| +key: string, +text: ?string |}>) => {
      setDraftCache((prevDrafts) => {
        const result = { ...prevDrafts };
        newDrafts.forEach((draft) => {
          if (draft.text) {
            result[draft.key] = draft.text;
          } else {
            delete result[draft.key];
          }
        });
        return result;
      });
    },
    [],
  );
  const updateDraft = React.useCallback(
    async (draft: {| +key: string, +text: string |}) => {
      const prevDraftText = draftCache[draft.key];
      setDrafts([draft]);
      try {
        return await global.CommCoreModule.updateDraft(draft);
      } catch (e) {
        setDrafts([{ key: draft.key, text: prevDraftText }]);
        throw e;
      }
    },
    [draftCache, setDrafts],
  );

  const moveDraft = React.useCallback(
    async (prevKey: string, newKey: string) => {
      const value = draftCache[prevKey];
      if (!value) {
        return false;
      }
      setDrafts([
        { key: newKey, text: value },
        { key: prevKey, text: null },
      ]);
      try {
        return await global.CommCoreModule.moveDraft(prevKey, newKey);
      } catch (e) {
        setDrafts([
          { key: newKey, text: null },
          { key: prevKey, text: value },
        ]);
        throw e;
      }
    },
    [draftCache, setDrafts],
  );

  const coreData = React.useMemo(
    () => ({
      drafts: {
        data: draftCache,
        updateDraft,
        moveDraft,
      },
    }),
    [draftCache, updateDraft, moveDraft],
  );

  return (
    <CoreDataContext.Provider value={coreData}>
      {props.children}
    </CoreDataContext.Provider>
  );
}

export default CoreDataProvider;
