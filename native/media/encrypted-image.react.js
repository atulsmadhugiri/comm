// @flow

import invariant from 'invariant';
import * as React from 'react';

import { MediaCacheContext } from 'lib/components/media-cache-provider.react.js';
import { connectionSelector } from 'lib/selectors/keyserver-selectors.js';

import { decryptBase64, useFetchAndDecryptMedia } from './encryption-utils.js';
import LoadableImage from './loadable-image.react.js';
import { authoritativeKeyserverID } from '../authoritative-keyserver.js';
import { useSelector } from '../redux/redux-utils.js';
import type { ImageSource } from '../types/react-native.js';
import type { ImageStyle } from '../types/styles.js';

type BaseProps = {
  +blobURI: string,
  +encryptionKey: string,
  +onLoad?: (uri: string) => void,
  +spinnerColor: string,
  +style: ImageStyle,
  +invisibleLoad: boolean,
  +thumbHash?: ?string,
};
type Props = {
  ...BaseProps,
};

function EncryptedImage(props: Props): React.Node {
  const {
    blobURI,
    encryptionKey,
    onLoad: onLoadProp,
    thumbHash: encryptedThumbHash,
  } = props;

  const fetchAndDecryptMedia = useFetchAndDecryptMedia();

  const mediaCache = React.useContext(MediaCacheContext);
  const [source, setSource] = React.useState<?ImageSource>(null);

  const connection = useSelector(connectionSelector(authoritativeKeyserverID));
  invariant(connection, 'keyserver missing from keyserverStore');
  const connectionStatus = connection.status;
  const prevConnectionStatusRef = React.useRef(connectionStatus);
  const [attempt, setAttempt] = React.useState(0);
  const [errorOccured, setErrorOccured] = React.useState(false);

  if (prevConnectionStatusRef.current !== connectionStatus) {
    if (!source && connectionStatus === 'connected') {
      setAttempt(attempt + 1);
    }
    prevConnectionStatusRef.current = connectionStatus;
  }

  const placeholder = React.useMemo(() => {
    if (!encryptedThumbHash) {
      return null;
    }
    try {
      const decryptedThumbHash = decryptBase64(
        encryptedThumbHash,
        encryptionKey,
      );
      return { thumbhash: decryptedThumbHash };
    } catch (e) {
      return null;
    }
  }, [encryptedThumbHash, encryptionKey]);

  React.useEffect(() => {
    let isMounted = true;
    setSource(null);

    const loadDecrypted = async () => {
      const cached = await mediaCache?.get(blobURI);
      if (cached && isMounted) {
        setSource({ uri: cached });
        return;
      }

      const { result } = await fetchAndDecryptMedia(blobURI, encryptionKey, {
        destination: 'data_uri',
      });

      if (isMounted) {
        if (result.success) {
          void mediaCache?.set(blobURI, result.uri);
          setSource({ uri: result.uri });
        } else {
          setErrorOccured(true);
        }
      }
    };

    void loadDecrypted();

    return () => {
      isMounted = false;
    };
  }, [attempt, blobURI, encryptionKey, mediaCache, fetchAndDecryptMedia]);

  const onLoad = React.useCallback(() => {
    onLoadProp && onLoadProp(blobURI);
  }, [blobURI, onLoadProp]);

  const { style, spinnerColor, invisibleLoad } = props;

  return (
    <LoadableImage
      placeholder={placeholder}
      source={source}
      onLoad={onLoad}
      spinnerColor={spinnerColor}
      style={style}
      invisibleLoad={invisibleLoad}
      key={attempt}
      errorOccured={errorOccured}
    />
  );
}

export default EncryptedImage;
