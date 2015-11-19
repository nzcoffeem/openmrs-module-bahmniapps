'use strict';

angular.module('bahmni.registration')
    .controller('CreatePatientController', ['$scope', '$rootScope', '$state', 'patientService', 'Preferences', 'patient', 'spinner', 'appService', 'messagingService', 'ngDialog', '$q', '$bahmniCookieStore', 'locationService',
        function ($scope, $rootScope, $state, patientService, preferences, patientModel, spinner, appService, messagingService, ngDialog, $q, $bahmniCookieStore, locationService) {
            var dateUtil = Bahmni.Common.Util.DateUtil;
            $scope.actions = {};
            var configValueForEnterId = appService.getAppDescriptor().getConfigValue('showEnterID');
            $scope.addressHierarchyConfigs = appService.getAppDescriptor().getConfigValue("addressHierarchy");
            $scope.showEnterID = configValueForEnterId === null ? true : configValueForEnterId;
            $scope.today = dateUtil.getDateWithoutTime(dateUtil.now());

            (function () {
                $scope.patient = patientModel.create();
                $scope.identifierSources = $rootScope.patientConfiguration.identifierSources;
                var identifierPrefix = _.findWhere($scope.identifierSources, {prefix: preferences.identifierPrefix});
                $scope.patient.identifierPrefix = identifierPrefix || $scope.identifierSources[0];
                $scope.hasOldIdentifier = preferences.hasOldIdentifier;
            })();

            var prepopulateFields = function () {
                var fieldsToPopulate = appService.getAppDescriptor().getConfigValue("prepopulateFields");
                if (fieldsToPopulate) {
                    locationService.getAllByTag("Login Location").then(
                        function (response) {
                            var locations = response.data.results;
                            var cookie = $bahmniCookieStore.get(Bahmni.Common.Constants.locationCookieName);
                            var loginLocation = _.find(locations, function(location){
                                return location.uuid == cookie.uuid;
                            });
                            angular.forEach(fieldsToPopulate, function (field) {
                                var addressLevel = _.find($scope.addressLevels, function (level) {
                                    return level.name == field
                                });
                                if (addressLevel) {
                                    $scope.patient.address[addressLevel.addressField] = loginLocation[addressLevel.addressField];
                                }
                            })
                        },
                        function () {
                            messagingService.showMessage('error', 'Unable to fetch locations. Please reload the page.');
                        }
                    );
                }
            };

            prepopulateFields();


            var addNewRelationships = function () {
                var newRelationships = _.filter($scope.patient.newlyAddedRelationships, function (relationship) {
                    return relationship.relationshipType && relationship.relationshipType.uuid;
                });
                newRelationships = _.each(newRelationships, function (relationship) {
                    delete relationship.patientIdentifier;
                    delete relationship.content;
                    delete relationship.providerName;
                });
                $scope.patient.relationships = $scope.patient.relationships.concat(newRelationships);
            };

            var getConfirmationViaNgDialog = function (config) {
                var ngDialogLocalScope = config.scope.$new();
                ngDialogLocalScope.yes = function () {
                    ngDialog.close();
                    config.yesCallback();
                };
                ngDialogLocalScope.no = function () {
                    ngDialog.close();
                };
                ngDialog.open({
                    template: config.template,
                    data: config.data,
                    scope: ngDialogLocalScope
                });
            };

            var createPatientAndSetIdentifier = function (sourceName, nextIdentifierToBe) {
                return patientService.setLatestIdentifier(sourceName, nextIdentifierToBe)
                .then(function (response) {
                    return patientService.create($scope.patient)
                })
                .then(copyPatientProfileDataToScope);
            };

            var createPatientWithGeneratedIdentifier = function() {
                return patientService.generateIdentifier($scope.patient)
                .then(function (response) {
                    $scope.patient.identifier = response.data;
                    return patientService.create($scope.patient)
                })
                .then(copyPatientProfileDataToScope);
            }

            var createPatientWithGivenIdentifier = function() {
                var sourceName = $scope.patient.identifierPrefix.prefix;
                var givenIdentifier = parseInt($scope.patient.registrationNumber);
                var nextIdentifierToBe = parseInt($scope.patient.registrationNumber) + 1;
                return patientService.getLatestIdentifier($scope.patient.identifierPrefix.prefix).then(function (response) {
                    var latestIdentifier = response.data;
                    var sizeOfTheJump = givenIdentifier - latestIdentifier;
                    if (sizeOfTheJump === 0) {
                        return createPatientAndSetIdentifier(sourceName, nextIdentifierToBe);
                    }
                    else if (sizeOfTheJump > 0) {
                        return getConfirmationViaNgDialog({
                            template: 'views/customIdentifierConfirmation.html',
                            data: {sizeOfTheJump: sizeOfTheJump},
                            scope: $scope,
                            yesCallback: function () {
                                return createPatientAndSetIdentifier(sourceName, nextIdentifierToBe);
                            }
                        });
                    }
                    else {
                        return patientService.create($scope.patient).then(copyPatientProfileDataToScope);
                    }
                });
            }

            var createPromise = function () {
                var deferred = $q.defer();
                var resolved = function() {return deferred.resolve({})};

                setPreferences();
                addNewRelationships();
                var errMsg = Bahmni.Common.Util.ValidationUtil.validate($scope.patient, $scope.patientConfiguration.personAttributeTypes);
                if (errMsg) {
                    messagingService.showMessage('formError', errMsg);
                    return deferred.resolve();
                }

                if (!$scope.hasOldIdentifier) {
                    createPatientWithGeneratedIdentifier().finally(resolved)
                }
                else {
                    createPatientWithGivenIdentifier().finally(resolved);
                }
                return deferred.promise;
            };

            var setPreferences = function () {
                preferences.identifierPrefix = $scope.patient.identifierPrefix.prefix;
            };

            var copyPatientProfileDataToScope = function (response) {
                var patientProfileData = response.data;
                $scope.patient.uuid = patientProfileData.patient.uuid;
                $scope.patient.name = patientProfileData.patient.person.names[0].display;
                $scope.patient.isNew = true;
                $scope.patient.registrationDate = dateUtil.now();
                $scope.patient.newlyAddedRelationships = [{}];
                $scope.actions.followUpAction(patientProfileData);
            };

            $scope.create = function() {
                $scope.saveInProgress = true;
                spinner.forPromise(createPromise()).finally(function() {
                    $scope.saveInProgress = false;
                });
            }

            $scope.afterSave = function () {
                messagingService.showMessage("info", "REGISTRATION_LABEL_SAVED");
                $state.go("patient.edit", {patientUuid: $scope.patient.uuid});
            };
        }
    ]);
