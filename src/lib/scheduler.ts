import { IGlobalDB, IWebService, IService, INodeWithServices, Configuration } from '@dockate/commons';
import { ILogger, LoggerFactory } from '@log4js-universal/logger';
import { Dictionnary } from 'arrayplus';
import { DockerAPI, IServiceInfos } from './get-docker-infos';
import { IServiceConstraint } from '@dockate/commons/lib/i-service-constraint';

export class Scheduler {
    private static LOGGER: ILogger = LoggerFactory.getLogger("dockate-core.Scheduler");
    private lastDbCalculed: IGlobalDB = null;
    private api: DockerAPI = new DockerAPI();

    public constructor(
        private webService: IWebService
    ) {

    }

    public start() {
        Scheduler.LOGGER.debug("Scheduler started");
        Configuration.INSTANCE.getConfig().then((config) => {
            const intervalBetweenCheckServices = config.intervalBetweenCheckServices;
            const callbackRun = () => {
                // Ignore errors!
                this.execute().catch((e) => {
                    console.error(e);
                    this.lastDbCalculed = null;
                }).then(() => {
                    if (intervalBetweenCheckServices > 0) {
                        setTimeout(() => {
                            callbackRun();
                        }, intervalBetweenCheckServices);
                    } else {
                        Scheduler.LOGGER.debug("Scheduler ended because config.intervalBetweenCheckServices is <= 0 : %1", intervalBetweenCheckServices);
                    }
                });
            }
            callbackRun();
        });
    }

    private objHasSomeKeys<T>(obj: T, test: RegExp | ((o: string | number) => boolean)): boolean {
        if (test instanceof RegExp) {
            for (let key in obj) {
                if (test.test(key)) {
                    return true;
                }
            }
        } else {
            for (let key in obj) {
                if ((test as (o: string | number) => boolean)(key)) {
                    return true;
                }
            }
        }
        return false;
    }

    private extractDockateKeys(serviceName: string, labels: {[key: string]: string}): IServiceConstraint[] {
        const results: IDockateKeys = {
            constraintsByLevel: Dictionnary.create(),
            rootConstraints: null
        };
        for (let key in labels) {
            const parser = /^dockate\.([0-9]+\.)?((?:port)|(?:domains)|(?:paths)|(?:authents)$)/.exec(key);
            if (!parser) {
                continue;
            }
            let constraints: IServiceConstraint = null;
            if (parser[1] === undefined) {
                constraints = results.rootConstraints;
                if (!constraints) {
                    constraints = {
                        authents: null,
                        domains: null,
                        port: null,
                        order: null,
                        paths: null
                    };
                    results.rootConstraints = constraints;
                }
            } else {
                const level: number = Number(parser[1]);
                constraints = results.constraintsByLevel.getElement(level);
                if (!constraints) {
                    constraints = {
                        authents: null,
                        domains: null,
                        port: null,
                        order: level,
                        paths: null
                    };
                    results.constraintsByLevel.addElement(level, constraints);
                }
            }
            switch (parser[2]) {
                case 'port':
                    constraints.port = Number(labels[key]);
                    break;
                case 'domains':
                    constraints.domains = labels[key].split(',');
                    break;
                case 'paths':
                    constraints.paths = labels[key].split(',');
                    break;
                case 'authents':
                    constraints.authents = labels[key].split(',');
                    break;
            }
        }
        const constraintsToRemove: IServiceConstraint[] = [];
        results.constraintsByLevel.forEach((constraints) => {
            if (constraints.port === null && results.rootConstraints) {
                constraints.port = results.rootConstraints.port;
            }
            if (constraints.port === null) {
                // Ignore this constraint
                Scheduler.LOGGER.warn('Service %1 : Constraint %2 ignored because no port given', serviceName, constraints.order);
                constraintsToRemove.push(constraints);
                return;
            }
            if (constraints.authents === null && results.rootConstraints) {
                constraints.authents = results.rootConstraints.authents;
            }
            if (constraints.domains === null && results.rootConstraints) {
                constraints.domains = results.rootConstraints.domains;
            }
            if (constraints.paths === null && results.rootConstraints) {
                constraints.paths = results.rootConstraints.paths;
            }
        });
        if (constraintsToRemove.length > 0) {
            constraintsToRemove.forEach(p => results.constraintsByLevel.removeElement(p.order));
        }
        return results.constraintsByLevel;
    }

    private configMustBeRecalculed(): Promise<boolean> {
        if (this.lastDbCalculed === null) {
            Scheduler.LOGGER.debug("UPDATE > because no this.lastDbCalculed");
            return Promise.resolve(true);
        }
        return this.api.getServices().then((services) => {
            let servicesFound: number = 0;
            const hasSomeServicesDifferents: boolean = services.some((service) => {
                if (!this.objHasSomeKeys(service.Spec.TaskTemplate.ContainerSpec.Labels, /^dockate\.(?:[0-9]+\.)?port$/)) {
                    Scheduler.LOGGER.debug("Ignore service %1 because no dockate.port detected on labels", service.Spec.Name);
                    // Ignore this service
                    return false;
                }
                Scheduler.LOGGER.debug("Service %1 detected with the internal port %2", service.Spec.Name, service.Spec.TaskTemplate.ContainerSpec.Labels['dockate.port']);
                servicesFound++;
                const serviceFromDb = this.lastDbCalculed.services.getElement(service.Spec.Name)
                if (!serviceFromDb) {
                    Scheduler.LOGGER.debug("UPDATE > because service", service.Spec.Name, " not found");
                    return true;
                }
                if (service.Endpoint.VirtualIPs.length !== serviceFromDb.virtualIPs.length) {
                    Scheduler.LOGGER.debug("UPDATE > because service", service.Spec.Name, " has virtualips", service.Endpoint.VirtualIPs, "but in the last check: ", serviceFromDb.virtualIPs);
                    return true;
                }
                return service.Endpoint.VirtualIPs.some((virtualIP) => {
                    if (!serviceFromDb.virtualIPs.hasElement(virtualIP.Addr)) {
                        Scheduler.LOGGER.debug("UPDATE > because service", service.Spec.Name, " has virtualips", service.Endpoint.VirtualIPs, "but in the last check: ", serviceFromDb.virtualIPs, "(ip", virtualIP.Addr, " not found)");
                        return true;
                    }
                    return false;
                });
            });
            if (hasSomeServicesDifferents) {
                return hasSomeServicesDifferents;
            }
            if (this.lastDbCalculed.services.length !== servicesFound) {
                // Nb services !==
                Scheduler.LOGGER.debug("UPDATE > because service.length from db is %1 and from api is %2", this.lastDbCalculed.services.length, servicesFound);
                return true;
            }
            return false;
        });
    }

    private execute(): Promise<void> {
        Scheduler.LOGGER.debug("Run execute");
        return this.configMustBeRecalculed().then((mustBeRecalculated) => {
            if (!mustBeRecalculated) {
                Scheduler.LOGGER.debug("Not update necessary");
                return;
            }
            Scheduler.LOGGER.info("Get new swarm configuration");
            const nodesWithService: INodeWithServices[] = [];
            const servicesAll: Dictionnary<string, IService> = Dictionnary.create();

            return Promise.all([
                this.api.getNodes(),
                this.api.getServices()
            ]).then(([nodes, services]) => {
                const promises: Promise<any>[] = [];

                const serviceById: { [key: string]: IServiceInfos } = {};
                services.forEach((service) => {
                    serviceById[service.Spec.Name] = service;
                });
                nodes.forEach((node) => {
                    const nodeWithService: INodeWithServices = {
                        ID: node.ID,
                        NAME: node.Description.Hostname,
                        IP: node.Status.Addr,
                        SERVICES: [],
                    };
                    nodesWithService.push(nodeWithService);
                    promises.push(this.api.getNodePs(node.ID).then((containers) => {
                        containers.forEach((container) => {
                            if (container['DESIRED STATE'] !== 'Running') {
                                return;
                            }
                            let serviceFromDB: IServiceInfos = null;
                            if (!/^(.+)(?:\.[0-9]$)/.test(container.NAME)) {
                                serviceFromDB = serviceById[container.NAME];
                            } else {
                                serviceFromDB = serviceById[/^(.+)(?:\.[0-9]$)/.exec(container.NAME)[1]];
                            }
                            let service: IService = servicesAll.getElement(serviceFromDB.Spec.Name);
                            if (!service) {
                                service = {
                                    name: serviceFromDB.Spec.Name,
                                    ports: {},
                                    constraints: [],
                                    nodes: [],
                                    virtualIPs: Dictionnary.create<string, string>()
                                };
                                const allConstraints = this.extractDockateKeys(service.name, serviceFromDB.Spec.TaskTemplate.ContainerSpec.Labels);
                                if (allConstraints.length === 0) {
                                    //No information in service deployement
                                    Scheduler.LOGGER.warn('Service %1 ignored because no constraints detected', service.name);
                                    service = null;
                                } else {
                                    let hasSomePorts: boolean = false;
                                    allConstraints.forEach((constraints) => {
                                        const internalPortNumber: number = constraints.port;
                                        const externalPort = serviceFromDB.Endpoint.Ports.find((entry) => {
                                            if (entry.TargetPort === internalPortNumber) {
                                                return true;
                                            }
                                            return false;
                                        });
                                        if (externalPort) {
                                            hasSomePorts = true;
                                            service.constraints.push(constraints);
                                            service.ports[internalPortNumber] = externalPort.PublishedPort;
                                        } else {
                                            Scheduler.LOGGER.warn('Service %1 : Constraint %2 ignored because no external mapping found for port %3', service.name, constraints.order, internalPortNumber);
                                        }
                                    });
                                    if (!hasSomePorts) {
                                        Scheduler.LOGGER.warn('Service %1 ignored because no ports configured', service.name);
                                        service = null;
                                    }
                                }
                                if (service) {
                                    service.constraints.sort((a, b) => {
                                        return a.order - b.order;
                                    });
                                    servicesAll.addElement(serviceFromDB.Spec.Name, service);
                                    serviceFromDB.Endpoint.VirtualIPs.forEach((virtualIp) => {
                                        service.virtualIPs.addElement(virtualIp.Addr, virtualIp.Addr);
                                    });
                                }
                            }
                            if (service) {
                                service.nodes.push(nodeWithService);
                                nodeWithService.SERVICES.push(service);
                            }
                        });
                    }));
                });
                return Promise.all(promises);
            }).then(() => {
                return this.api.stop();
            }).then(() => {
                this.lastDbCalculed = {
                    nodes: nodesWithService,
                    services: servicesAll
                };
                return this.webService.updateConf(this.lastDbCalculed).then(() => {
                    return this.webService.stop();
                });
            });
        });
    }
}

interface IDockateKeys {
    rootConstraints: IServiceConstraint;
    constraintsByLevel: Dictionnary<number, IServiceConstraint>;
}