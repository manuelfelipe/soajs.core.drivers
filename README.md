# soajs.core.drivers

SOAJS Core Drivers is a repository that serves as a driver to both "Docker Swarm" and "Kubernetes" clustering 

and scheduling tools. The driver contains several APIs responsible for the management of the cluster, nodes,

services, and tasks. Examples of such APIs include, but are not limited to, service deployment node/service/task

deployment/deletion/update/inspection, in addition to maintenance operations, and logging.

---

##Installation

```sh
$ npm install soajs.core.drivers
```
---

#Service Features
The SOAJS Core Drivers contains several APIs to manage the Kubernetes cluster and/or Docker swarm:
* Node management APIs: Add/Update/Remove/Inspect.
* Service management APIs: Add/Update/Remove/Inspect/Redeploy.
* Task management APIs: Add/Update/Remove/Inspect/.
* Maintenance APIs.
* Logging APIs.

#Architecture
The "index.js" file serves as an entry point. Once it receives a request, the file redirects the request into the designated strategy. 

Each strategy, located in the /strategies directory, serves as an entry point, of every requesting targeting one of its APIs.

The APIs of each strategy are divided into two files, located in the /strategyFunctions directory. One file contains all the APIs 

concerned with node management. The other file contains all the remaining APIs.

#Control Flow
The repository was designed in a way to maximize the scalability of the code, while minimizing the coding efforts.

Below is an explanation of the control flow, all the way from the entry point, into the designated API.

Once a request arrives, the "index.js" file captures the request, checks if the targeted strategy exists.

If it exists, it checks if the requested API exists. Once the validation is complete, the request is redirected

to the requested strategy file, which in turn redirects the request to the file containing the destined API.

#Warning
* If running the test cases on OS X, after starting minikube, change the kubernetes proxy port: kubectl proxy -p 8001
* Running the test cases will delete all previous docker services and containers.