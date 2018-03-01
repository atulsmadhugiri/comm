// @flow

import type {
  ErrorReportCreationRequest,
  ErrorReportCreationResponse,
} from 'lib/types/report-types';
import type { DispatchActionPromise } from 'lib/utils/action-utils';
import type { AppState } from './redux-setup';
import type { ErrorData } from 'lib/types/report-types';

import * as React from 'react';
import {
  View,
  Text,
  Platform,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Clipboard,
} from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import _shuffle from 'lodash/fp/shuffle';
import ExitApp from 'react-native-exit-app';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import invariant from 'invariant';

import {
  includeDispatchActionProps,
  bindServerCalls,
} from 'lib/utils/action-utils';
import {
  sendErrorReportActionTypes,
  sendErrorReport,
} from 'lib/actions/report-actions';

import Button from './components/button.react';
import { store, persistor, persistConfig } from './redux-setup';
import reduxLogger from './redux-logger';

const errorTitles = [
  "Oh no!!",
  "Womp womp womp...",
];

type Props = {
  errorData: $ReadOnlyArray<ErrorData>,
  // Redux dispatch functions
  dispatchActionPromise: DispatchActionPromise,
  // async functions that hit server APIs
  sendErrorReport: (
    request: ErrorReportCreationRequest,
  ) => Promise<ErrorReportCreationResponse>,
};
type State = {|
  errorReportID: ?string,
|};
class Crash extends React.PureComponent<Props, State> {

  static propTypes = {
    errorData: PropTypes.arrayOf(PropTypes.shape({
      error: PropTypes.object.isRequired,
      info: PropTypes.shape({
        componentStack: PropTypes.string.isRequired,
      }),
    })).isRequired,
    dispatchActionPromise: PropTypes.func.isRequired,
    sendErrorReport: PropTypes.func.isRequired,
  };
  errorTitle = _shuffle(errorTitles)[0];
  state = {
    errorReportID: null,
  };

  componentDidMount() {
    this.props.dispatchActionPromise(
      sendErrorReportActionTypes,
      this.sendReport(),
    );
  }

  render() {
    const errorText = [...this.props.errorData]
      .reverse()
      .map(errorData => errorData.error.message)
      .join("\n");
    let crashID;
    if (this.state.errorReportID) {
      crashID = (
        <React.Fragment>
          <Text style={styles.errorReportIDText}>
            {this.state.errorReportID}
          </Text>
          <Button onPress={this.onCopyCrashReportID}>
            <Text style={styles.copyCrashReportIDButtonText}>
              (Copy)
            </Text>
          </Button>
        </React.Fragment>
      );
    } else {
      crashID = <ActivityIndicator size="small" />;
    }
    return (
      <View style={styles.container}>
        <Icon name="bug" size={32} color="red" />
        <Text style={styles.header}>{this.errorTitle}</Text>
        <Text style={styles.text}>I'm sorry, but the app crashed.</Text>
        <View style={styles.crashID}>
          <Text style={styles.crashIDText}>Crash report ID:</Text>
          <View style={styles.errorReportID}>
            {crashID}
          </View>
        </View>
        <Text style={styles.text}>
          Here's some text that's probably not helpful:
        </Text>
        <ScrollView style={styles.scrollView}>
          <Text style={styles.errorText}>
            {errorText}
          </Text>
        </ScrollView>
        <View style={styles.buttons}>
          <Button onPress={this.onPressKill} style={styles.button}>
            <Text style={styles.buttonText}>Kill the app</Text>
          </Button>
          <Button onPress={this.onPressWipe} style={styles.button}>
            <Text style={styles.buttonText}>Wipe state and kill app</Text>
          </Button>
        </View>
      </View>
    );
  }

  async sendReport() {
    const result = await this.props.sendErrorReport({
      deviceType: Platform.OS,
      errors: this.props.errorData.map(data => ({
        errorMessage: data.error.message,
        componentStack: data.info && data.info.componentStack,
      })),
      preloadedState: reduxLogger.preloadedState,
      currentState: store.getState(),
      actions: reduxLogger.actions,
      codeVersion: 0,
      stateVersion: persistConfig.version,
    });
    this.setState({ errorReportID: result.id });
  }

  onPressKill = () => {
    ExitApp.exitApp();
  }

  onPressWipe = () => {
    persistor.purge();
    ExitApp.exitApp();
  }

  onCopyCrashReportID = () => {
    invariant(this.state.errorReportID, "should be set");
    Clipboard.setString(this.state.errorReportID);
  }

}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: 'center',
  },
  header: {
    color: 'black',
    fontSize: 24,
    paddingBottom: 24,
  },
  text: {
    color: 'black',
    paddingBottom: 12,
  },
  errorText: {
    color: 'black',
    fontFamily: Platform.select({
      ios: "Menlo",
      default: "monospace",
    }),
  },
  scrollView: {
    flex: 1,
    maxHeight: 200,
    paddingHorizontal: 50,
    marginBottom: 24,
    marginTop: 12,
  },
  buttons: {
    flexDirection: "row",
  },
  button: {
    backgroundColor: "#FF0000",
    borderRadius: 5,
    paddingVertical: 5,
    paddingHorizontal: 10,
    marginHorizontal: 10,
  },
  buttonText: {
    color: "white",
    fontSize: 16,
  },
  crashID: {
    paddingTop: 2,
    paddingBottom: 12,
    flexDirection: 'row',
  },
  crashIDText: {
    color: 'black',
    paddingRight: 8,
  },
  copyCrashReportIDButtonText: {
    color: 'black',
    color: '#036AFF',
  },
  errorReportID: {
    flexDirection: 'row',
    height: 20,
  },
  errorReportIDText: {
    color: 'black',
    paddingRight: 8,
  },
});

export default connect(
  (state: AppState) => ({
    cookie: state.cookie,
  }),
  includeDispatchActionProps,
  bindServerCalls({ sendErrorReport }),
)(Crash);
